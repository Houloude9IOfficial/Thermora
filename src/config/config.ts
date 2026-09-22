import os from "node:os";
import path from "node:path";
import type { LogLevel, PowerAction, ThermalPolicy, ThermoraConfig } from "../types.js";

export type EnvironmentSource = Record<string, string | undefined>;

export type ConfigParseResult = {
  ok: boolean;
  config: ThermoraConfig;
  issues: string[];
};

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid Thermora configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export const DEFAULT_STATE_FILE_NAME = "state.json";

const DEFAULTS = {
  cpuMax: 90,
  gpuMax: 90,
  globalMax: 95,
  pollIntervalMs: 5000,
  requiredSamples: 3,
  action: "shutdown" as PowerAction,
  dryRun: true,
  apiEnabled: false,
  apiHost: "127.0.0.1",
  apiPort: 8787,
  logLevel: "info" as LogLevel,
};

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);
const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];
const POWER_ACTIONS: readonly PowerAction[] = ["shutdown", "restart"];

export type ConfigOverrides = {
  cpuMax?: string;
  gpuMax?: string;
  globalMax?: string;
  pollIntervalMs?: string;
  requiredSamples?: string;
  action?: string;
  dryRun?: boolean;
  apiEnabled?: boolean;
  apiHost?: string;
  apiPort?: string;
  logLevel?: string;
  stateFile?: string;
};

export function configOverridesToEnvironment(overrides: ConfigOverrides): EnvironmentSource {
  const environment: EnvironmentSource = {};
  if (overrides.cpuMax !== undefined) environment.THERMORA_CPU_MAX = overrides.cpuMax;
  if (overrides.gpuMax !== undefined) environment.THERMORA_GPU_MAX = overrides.gpuMax;
  if (overrides.globalMax !== undefined) environment.THERMORA_GLOBAL_MAX = overrides.globalMax;
  if (overrides.pollIntervalMs !== undefined) environment.THERMORA_POLL_INTERVAL_MS = overrides.pollIntervalMs;
  if (overrides.requiredSamples !== undefined) environment.THERMORA_REQUIRED_SAMPLES = overrides.requiredSamples;
  if (overrides.action !== undefined) environment.THERMORA_ACTION = overrides.action;
  if (overrides.dryRun !== undefined) environment.THERMORA_DRY_RUN = overrides.dryRun ? "true" : "false";
  if (overrides.apiEnabled !== undefined) environment.THERMORA_API_ENABLED = overrides.apiEnabled ? "true" : "false";
  if (overrides.apiHost !== undefined) environment.THERMORA_API_HOST = overrides.apiHost;
  if (overrides.apiPort !== undefined) environment.THERMORA_API_PORT = overrides.apiPort;
  if (overrides.logLevel !== undefined) environment.THERMORA_LOG_LEVEL = overrides.logLevel;
  if (overrides.stateFile !== undefined) environment.THERMORA_STATE_FILE = overrides.stateFile;
  return environment;
}

export function resolveStateFilePath(environment: EnvironmentSource = process.env): string {
  const configured = (environment.THERMORA_STATE_FILE ?? "").trim();
  if (configured.length > 0) return path.resolve(configured);
  return path.join(os.tmpdir(), "thermora", DEFAULT_STATE_FILE_NAME);
}

export function resolveLockFilePath(stateFile: string): string {
  return path.join(path.dirname(stateFile), "daemon.lock");
}

type NumberBounds = {
  min: number;
  max: number;
};

function readNumber(
  environment: EnvironmentSource,
  key: string,
  fallback: number,
  bounds: NumberBounds,
  issues: string[],
): number {
  const raw = environment[key];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    issues.push(`${key} must be an integer between ${bounds.min} and ${bounds.max} (received "${raw}")`);
    return fallback;
  }
  if (value < bounds.min || value > bounds.max) {
    issues.push(`${key} must be between ${bounds.min} and ${bounds.max} (received "${raw}")`);
    return fallback;
  }
  return value;
}

function readBoolean(
  environment: EnvironmentSource,
  key: string,
  fallback: boolean,
  issues: string[],
): boolean {
  const raw = environment[key];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  issues.push(`${key} must be true or false (received "${raw}")`);
  return fallback;
}

function readEnum<T extends string>(
  environment: EnvironmentSource,
  key: string,
  fallback: T,
  allowed: readonly T[],
  issues: string[],
): T {
  const raw = environment[key];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const normalized = raw.trim().toLowerCase() as T;
  if (!allowed.includes(normalized)) {
    issues.push(`${key} must be one of: ${allowed.join(", ")} (received "${raw}")`);
    return fallback;
  }
  return normalized;
}

function readHost(
  environment: EnvironmentSource,
  key: string,
  fallback: string,
  issues: string[],
): string {
  const raw = (environment[key] ?? "").trim();
  if (raw.length === 0) return fallback;
  if (/\s/.test(raw)) {
    issues.push(`${key} must be a host name or address without whitespace (received "${raw}")`);
    return fallback;
  }
  return raw;
}

export function parseConfig(environment: EnvironmentSource = process.env): ConfigParseResult {
  const issues: string[] = [];

  const cpuMax = readNumber(environment, "THERMORA_CPU_MAX", DEFAULTS.cpuMax, { min: 30, max: 150 }, issues);
  const gpuMax = readNumber(environment, "THERMORA_GPU_MAX", DEFAULTS.gpuMax, { min: 30, max: 150 }, issues);
  const globalMax = readNumber(environment, "THERMORA_GLOBAL_MAX", DEFAULTS.globalMax, { min: 30, max: 150 }, issues);
  const pollIntervalMs = readNumber(
    environment,
    "THERMORA_POLL_INTERVAL_MS",
    DEFAULTS.pollIntervalMs,
    { min: 500, max: 3_600_000 },
    issues,
  );
  const requiredSamples = readNumber(
    environment,
    "THERMORA_REQUIRED_SAMPLES",
    DEFAULTS.requiredSamples,
    { min: 1, max: 1000 },
    issues,
  );
  const apiPort = readNumber(environment, "THERMORA_API_PORT", DEFAULTS.apiPort, { min: 1, max: 65535 }, issues);
  const action = readEnum(environment, "THERMORA_ACTION", DEFAULTS.action, POWER_ACTIONS, issues);
  const logLevel = readEnum(environment, "THERMORA_LOG_LEVEL", DEFAULTS.logLevel, LOG_LEVELS, issues);
  const dryRun = readBoolean(environment, "THERMORA_DRY_RUN", DEFAULTS.dryRun, issues);
  const apiEnabled = readBoolean(environment, "THERMORA_API_ENABLED", DEFAULTS.apiEnabled, issues);
  const apiHost = readHost(environment, "THERMORA_API_HOST", DEFAULTS.apiHost, issues);

  const config: ThermoraConfig = {
    cpuMax,
    gpuMax,
    globalMax,
    pollIntervalMs,
    requiredSamples,
    action,
    dryRun,
    api: { enabled: apiEnabled, host: apiHost, port: apiPort },
    logLevel,
    stateFile: resolveStateFilePath(environment),
  };

  return { ok: issues.length === 0, config, issues };
}

export function loadConfig(environment: EnvironmentSource = process.env): ThermoraConfig {
  const result = parseConfig(environment);
  if (!result.ok) throw new ConfigError(result.issues);
  return result.config;
}

export function toThermalPolicy(config: ThermoraConfig): ThermalPolicy {
  return {
    limits: {
      cpuMax: config.cpuMax,
      gpuMax: config.gpuMax,
      globalMax: config.globalMax,
      requiredSamples: config.requiredSamples,
    },
    action: config.action,
  };
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  return /^127(\.\d{1,3}){3}$/.test(normalized);
}
