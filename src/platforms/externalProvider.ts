import type { DiagnosticCheck, GpuTemperature } from "../types.js";
import { FailureCooldown } from "../utils/cooldown.js";
import { tryCommand } from "../utils/exec.js";
import { formatTemperature } from "../utils/format.js";
import { normalizeTemperature } from "../utils/sensors.js";

export const PROVIDER_TIMEOUT_MS = 10_000;
export const PROVIDER_FAILURE_COOLDOWN_MS = 300_000;

export type ExternalProviderDefinition = {
  label: string;
  commandEnv: string;
  argsEnv: string;
};

export const MACOS_PROVIDER: ExternalProviderDefinition = {
  label: "macOS",
  commandEnv: "THERMORA_MACOS_SENSOR_COMMAND",
  argsEnv: "THERMORA_MACOS_SENSOR_ARGS",
};

export const WINDOWS_PROVIDER: ExternalProviderDefinition = {
  label: "Windows",
  commandEnv: "THERMORA_WINDOWS_SENSOR_COMMAND",
  argsEnv: "THERMORA_WINDOWS_SENSOR_ARGS",
};

export const LINUX_PROVIDER: ExternalProviderDefinition = {
  label: "Linux",
  commandEnv: "THERMORA_LINUX_SENSOR_COMMAND",
  argsEnv: "THERMORA_LINUX_SENSOR_ARGS",
};

const GPU_LABEL_PATTERN = /gpu|graphics|radeon|nvidia|geforce|metal|video/i;
const CPU_LABEL_PATTERN = /cpu|processor|core|die|package|pkg|soc|cluster|efficiency|performance|proximity/i;
const TEMPERATURE_KEY_PATTERN = /temp|thermal|die/i;
const UNIT_TEMPERATURE = /(-?\d+(?:\.\d+)?)\s*(?:°\s*)?(?:c|celsius|deg\s*c)\b/gi;
const SEPARATORS = /[\s\r\n,;|:=]+/g;

export type ProviderConfiguration = {
  command: string;
  args: string[];
};

export type ProviderTemperatures = {
  cpu: number[];
  gpu: GpuTemperature[];
};

export type InternalTemperatureSources = {
  cpu: {
    main: number | null;
    max: number | null;
    cores: number[];
  };
  gpuDevices: {
    name: string;
    vendor: string | null;
    temperature: number | null;
  }[];
};

export type ExternalTemperatureSources = {
  cpu: readonly number[];
  gpu: readonly GpuTemperature[];
};

export function mergeSensorSources(
  internal: InternalTemperatureSources,
  external: ExternalTemperatureSources,
): InternalTemperatureSources {
  const cpuAvailable = internal.cpu.main !== null || internal.cpu.max !== null || internal.cpu.cores.length > 0;
  const gpuAvailable = internal.gpuDevices.some((device) => device.temperature !== null);

  const cpu =
    cpuAvailable || external.cpu.length === 0
      ? internal.cpu
      : {
          main: external.cpu[0] ?? null,
          max: null,
          cores: [...external.cpu],
        };

  const gpuDevices =
    gpuAvailable || external.gpu.length === 0
      ? internal.gpuDevices
      : external.gpu.map((device) => ({
          name: device.name,
          vendor: device.vendor,
          temperature: device.temperature,
        }));

  return { cpu, gpuDevices };
}

export type ProviderOutcome = ProviderTemperatures & {
  configured: boolean;
  ok: boolean;
  command: string | null;
  error: string | null;
};

export function readProviderConfiguration(
  definition: ExternalProviderDefinition,
  environment: NodeJS.ProcessEnv = process.env,
): ProviderConfiguration | null {
  const command = (environment[definition.commandEnv] ?? "").trim();
  if (command.length === 0) return null;
  const args = (environment[definition.argsEnv] ?? "").trim();
  return { command, args: args.length === 0 ? [] : args.split(/\s+/) };
}

export function describeProviderConfiguration(configuration: ProviderConfiguration): string {
  return [configuration.command, ...configuration.args].join(" ");
}

function cleanLabel(raw: string): string | null {
  const line = raw.slice(raw.lastIndexOf("\n") + 1);
  const segments = line.split(/[,;|]/);
  const tail = segments[segments.length - 1] ?? "";
  const label = tail.replace(SEPARATORS, " ").trim();
  return label.length === 0 ? null : label;
}

type ClassifiedValue = {
  label: string;
  value: number;
};

function classify(values: readonly ClassifiedValue[]): ProviderTemperatures {
  const cpu: number[] = [];
  const gpu: GpuTemperature[] = [];
  const unlabeled: number[] = [];

  for (const entry of values) {
    const value = normalizeTemperature(entry.value);
    if (value === null) continue;
    const label = prettifyLabel(entry.label.trim());
    if (label.length === 0) {
      unlabeled.push(value);
      continue;
    }
    if (GPU_LABEL_PATTERN.test(label)) {
      gpu.push({ name: label, vendor: null, temperature: value });
      continue;
    }
    if (CPU_LABEL_PATTERN.test(label)) cpu.push(value);
  }

  if (cpu.length === 0 && gpu.length === 0) cpu.push(...unlabeled);

  return { cpu, gpu };
}

function collectTextValues(output: string): ClassifiedValue[] {
  const values: ClassifiedValue[] = [];
  let cursor = 0;
  let foundUnit = false;

  for (const match of output.matchAll(UNIT_TEMPERATURE)) {
    foundUnit = true;
    const index = match.index;
    const label = cleanLabel(output.slice(cursor, index)) ?? "";
    values.push({ label, value: Number(match[1]) });
    cursor = index + match[0].length;
  }

  if (foundUnit) return values;

  for (const segment of output.split(/[\r\n,;|]+/)) {
    const text = segment.trim();
    if (text.length === 0) continue;
    const numberMatch = /-?\d+(?:\.\d+)?/.exec(text);
    if (numberMatch === null) continue;
    const trailing = text.slice(numberMatch.index + numberMatch[0].length).trim();
    if (trailing.length > 0) continue;
    values.push({ label: cleanLabel(text.slice(0, numberMatch.index)) ?? "", value: Number(numberMatch[0]) });
  }

  return values;
}

const GENERIC_JSON_KEYS = new Set([
  "temp",
  "temps",
  "temperature",
  "temperatures",
  "thermal",
  "sensor",
  "sensors",
  "data",
  "metrics",
  "value",
  "values",
  "avg",
  "average",
  "current",
]);

const ACRONYMS = new Set(["cpu", "gpu", "ane", "smc", "soc", "ram"]);

function prettifyLabel(label: string): string {
  return label
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => (ACRONYMS.has(part.toLowerCase()) ? part.toUpperCase() : part))
    .join(" ");
}

function jsonLabel(path: string[], hint: string | null, key: string): string {
  const parts = [...(hint === null ? path.slice(0, -1) : [hint]), key];
  const seen = new Set<string>();
  const meaningful: string[] = [];

  for (const part of parts.join(" ").replace(/[_-]+/g, " ").split(/\s+/)) {
    const normalized = part.toLowerCase();
    if (normalized.length === 0) continue;
    if (GENERIC_JSON_KEYS.has(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    meaningful.push(part);
  }

  return prettifyLabel(meaningful.length === 0 ? key : meaningful.join(" "));
}

function jsonNameHint(record: Record<string, unknown>): string | null {
  for (const key of ["name", "label", "sensor", "device", "type", "id"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
  }
  return null;
}

function collectJsonValues(value: unknown, path: string[] = [], hint: string | null = null): ClassifiedValue[] {
  if (typeof value === "number") {
    const key = path[path.length - 1] ?? "";
    if (!TEMPERATURE_KEY_PATTERN.test(key)) return [];
    return [{ label: jsonLabel(path, hint, key), value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectJsonValues(entry, [...path, String(index + 1)], hint));
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const nestedHint = jsonNameHint(record) ?? hint;
    return Object.entries(record).flatMap(([key, entry]) => collectJsonValues(entry, [...path, key], nestedHint));
  }
  return [];
}

function parseJsonLines(output: string): ClassifiedValue[] {
  const values: ClassifiedValue[] = [];
  for (const line of output.split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) continue;
    try {
      values.push(...collectJsonValues(JSON.parse(text) as unknown));
    } catch {
      continue;
    }
  }
  return values;
}

function usable(values: readonly ClassifiedValue[]): ProviderTemperatures | null {
  if (values.length === 0) return null;
  const classified = classify(values);
  if (classified.cpu.length === 0 && classified.gpu.length === 0) return null;
  return classified;
}

export function parseProviderTemperatures(output: string): ProviderTemperatures {
  const trimmed = output.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const fromJson = usable(collectJsonValues(JSON.parse(trimmed) as unknown));
      if (fromJson !== null) return fromJson;
    } catch {
      const fromLines = usable(parseJsonLines(output));
      if (fromLines !== null) return fromLines;
    }
  }
  return classify(collectTextValues(output));
}

const cooldown = new FailureCooldown<string>(PROVIDER_FAILURE_COOLDOWN_MS);

export function resetProviderState(): void {
  cooldown.reset();
}

export function isProviderCoolingDown(command: string): boolean {
  return cooldown.active(command);
}

export async function readExternalTemperatures(
  definition: ExternalProviderDefinition,
  configuration: ProviderConfiguration | null = readProviderConfiguration(definition),
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<ProviderOutcome> {
  if (configuration === null) {
    return { configured: false, ok: false, cpu: [], gpu: [], command: null, error: null };
  }

  const command = describeProviderConfiguration(configuration);
  if (cooldown.active(command)) {
    return {
      configured: true,
      ok: false,
      cpu: [],
      gpu: [],
      command,
      error: cooldown.get(command) ?? "provider is cooling down after a failure",
    };
  }

  const result = await tryCommand(configuration.command, configuration.args, { timeoutMs });
  if (!result.ok) {
    const error = result.error ?? `exited with code ${result.code ?? "unknown"}`;
    cooldown.record(command, error);
    return { configured: true, ok: false, cpu: [], gpu: [], command, error };
  }

  const parsed = parseProviderTemperatures(result.stdout);
  if (parsed.cpu.length === 0 && parsed.gpu.length === 0) {
    const excerpt = result.stdout.trim().split(/\r?\n/)[0] ?? "";
    const error =
      excerpt.length === 0
        ? "produced no output"
        : `produced no recognizable temperature (first line: ${excerpt})`;
    cooldown.record(command, error);
    return { configured: true, ok: false, cpu: [], gpu: [], command, error };
  }

  cooldown.clear(command);
  return { configured: true, ok: true, cpu: parsed.cpu, gpu: parsed.gpu, command, error: null };
}

export async function sensorProviderDiagnostics(
  definition: ExternalProviderDefinition,
): Promise<DiagnosticCheck[]> {
  const configuration = readProviderConfiguration(definition);
  if (configuration === null) {
    return [
      {
        name: `External sensor provider (${definition.label})`,
        status: "ok",
        detail: `not configured. Set ${definition.commandEnv} to a command that prints CPU or GPU temperatures to supply readings when the operating system exposes none`,
      },
    ];
  }

  const command = describeProviderConfiguration(configuration);
  const outcome = await readExternalTemperatures(definition, configuration);
  const name = `External sensor provider (${definition.label})`;

  if (!outcome.ok) {
    const reason = (outcome.error ?? "unknown error").replace(`${command} `, "");
    return [{ name, status: "fail", detail: `${command} did not provide a temperature: ${reason}` }];
  }

  const parts: string[] = [];
  const cpuHighest = outcome.cpu.length === 0 ? null : Math.max(...outcome.cpu);
  if (cpuHighest !== null) parts.push(`CPU ${formatTemperature(cpuHighest)}`);
  for (const device of outcome.gpu) {
    parts.push(`${device.name} ${formatTemperature(device.temperature)}`);
  }

  return [{ name, status: "ok", detail: `${command} reported ${parts.join(", ")}` }];
}
