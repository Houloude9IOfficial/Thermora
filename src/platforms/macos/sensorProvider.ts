import type { DiagnosticCheck, GpuTemperature } from "../../types.js";
import { formatTemperature } from "../../utils/format.js";
import { tryCommand } from "../../utils/exec.js";
import { normalizeTemperature } from "../../utils/sensors.js";

export const MACOS_SENSOR_COMMAND_ENV = "THERMORA_MACOS_SENSOR_COMMAND";
export const MACOS_SENSOR_ARGS_ENV = "THERMORA_MACOS_SENSOR_ARGS";
export const PROVIDER_TIMEOUT_MS = 10_000;
export const PROVIDER_FAILURE_COOLDOWN_MS = 300_000;

const GPU_LABEL_PATTERN = /gpu|graphics|radeon|nvidia|geforce|metal|video/i;
const CPU_LABEL_PATTERN = /cpu|processor|core|die|package|pkg|soc|cluster|efficiency|performance|proximity/i;
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

export type ProviderOutcome = ProviderTemperatures & {
  configured: boolean;
  ok: boolean;
  command: string | null;
  error: string | null;
};

export function readProviderConfiguration(environment: NodeJS.ProcessEnv = process.env): ProviderConfiguration | null {
  const command = (environment[MACOS_SENSOR_COMMAND_ENV] ?? "").trim();
  if (command.length === 0) return null;
  const args = (environment[MACOS_SENSOR_ARGS_ENV] ?? "").trim();
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

export function parseProviderTemperatures(output: string): ProviderTemperatures {
  const cpu: number[] = [];
  const gpu: GpuTemperature[] = [];
  const unlabeled: number[] = [];

  const assign = (label: string | null, rawValue: number): void => {
    const value = normalizeTemperature(rawValue);
    if (value === null) return;
    if (label === null) {
      unlabeled.push(value);
      return;
    }
    if (GPU_LABEL_PATTERN.test(label)) {
      gpu.push({ name: label, vendor: null, temperature: value });
      return;
    }
    if (CPU_LABEL_PATTERN.test(label)) cpu.push(value);
  };

  let cursor = 0;
  let foundUnit = false;
  for (const match of output.matchAll(UNIT_TEMPERATURE)) {
    foundUnit = true;
    const index = match.index;
    assign(cleanLabel(output.slice(cursor, index)), Number(match[1]));
    cursor = index + match[0].length;
  }

  if (!foundUnit) {
    for (const segment of output.split(/[\r\n,;|]+/)) {
      const text = segment.trim();
      if (text.length === 0) continue;
      const numberMatch = /-?\d+(?:\.\d+)?/.exec(text);
      if (numberMatch === null) continue;
      const trailing = text.slice(numberMatch.index + numberMatch[0].length).trim();
      if (trailing.length > 0) continue;
      assign(cleanLabel(text.slice(0, numberMatch.index)), Number(numberMatch[0]));
    }
  }

  if (cpu.length === 0 && gpu.length === 0) cpu.push(...unlabeled);

  return { cpu, gpu };
}

type FailureRecord = {
  at: number;
  error: string;
};

const failures = new Map<string, FailureRecord>();

export function resetProviderState(): void {
  failures.clear();
}

export function isProviderCoolingDown(command: string, now: number = Date.now()): boolean {
  const failure = failures.get(command);
  if (failure === undefined) return false;
  return now - failure.at < PROVIDER_FAILURE_COOLDOWN_MS;
}

function recordFailure(command: string, error: string): void {
  failures.set(command, { at: Date.now(), error });
}

export async function readExternalTemperatures(
  configuration: ProviderConfiguration | null = readProviderConfiguration(),
  timeoutMs: number = PROVIDER_TIMEOUT_MS,
): Promise<ProviderOutcome> {
  if (configuration === null) {
    return { configured: false, ok: false, cpu: [], gpu: [], command: null, error: null };
  }

  const command = describeProviderConfiguration(configuration);
  const failure = failures.get(command);
  if (failure !== undefined && isProviderCoolingDown(command)) {
    return { configured: true, ok: false, cpu: [], gpu: [], command, error: failure.error };
  }

  const result = await tryCommand(configuration.command, configuration.args, { timeoutMs });
  if (!result.ok) {
    const error = result.error ?? `exited with code ${result.code ?? "unknown"}`;
    recordFailure(command, error);
    return { configured: true, ok: false, cpu: [], gpu: [], command, error };
  }

  const parsed = parseProviderTemperatures(result.stdout);
  if (parsed.cpu.length === 0 && parsed.gpu.length === 0) {
    const excerpt = result.stdout.trim().split(/\r?\n/)[0] ?? "";
    const error =
      excerpt.length === 0
        ? "produced no output"
        : `produced no recognizable temperature (first line: ${excerpt})`;
    recordFailure(command, error);
    return { configured: true, ok: false, cpu: [], gpu: [], command, error };
  }

  failures.delete(command);
  return { configured: true, ok: true, cpu: parsed.cpu, gpu: parsed.gpu, command, error: null };
}

export async function sensorProviderDiagnostics(): Promise<DiagnosticCheck[]> {
  const configuration = readProviderConfiguration();
  if (configuration === null) {
    return [
      {
        name: "External sensor provider",
        status: "ok",
        detail: `not configured. Set ${MACOS_SENSOR_COMMAND_ENV} to an smctemp, istats or osx-cpu-temp style command to supply readings when macOS exposes none`,
      },
    ];
  }

  const command = describeProviderConfiguration(configuration);
  const outcome = await readExternalTemperatures(configuration);

  if (!outcome.ok) {
    const reason = (outcome.error ?? "unknown error").replace(`${command} `, "");
    return [
      {
        name: "External sensor provider",
        status: "fail",
        detail: `${command} did not provide a temperature: ${reason}`,
      },
    ];
  }

  const parts: string[] = [];
  const cpuHighest = outcome.cpu.length === 0 ? null : Math.max(...outcome.cpu);
  if (cpuHighest !== null) parts.push(`CPU ${formatTemperature(cpuHighest)}`);
  for (const device of outcome.gpu) {
    parts.push(`${device.name} ${formatTemperature(device.temperature)}`);
  }

  return [
    {
      name: "External sensor provider",
      status: "ok",
      detail: `${command} reported ${parts.join(", ")}`,
    },
  ];
}
