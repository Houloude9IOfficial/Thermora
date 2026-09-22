import type { ConfigOverrides } from "../config/config.js";
import { CliUsageError, type Options } from "./args.js";

export type OverrideReadResult =
  | { ok: true; overrides: ConfigOverrides }
  | { ok: false; message: string };

function readToggle(options: Options, enableName: string, disableName: string): boolean | null {
  const disabled = options.boolean(disableName);
  if (disabled === true) return false;
  return options.boolean(enableName);
}

export function readOverrides(options: Options): OverrideReadResult {
  try {
    const overrides: ConfigOverrides = {};

    const dryRun = readToggle(options, "dry-run", "no-dry-run");
    if (dryRun !== null) overrides.dryRun = dryRun;

    const apiEnabled = readToggle(options, "api", "no-api");
    if (apiEnabled !== null) overrides.apiEnabled = apiEnabled;

    const cpuMax = options.value("cpu-max");
    if (cpuMax !== null) overrides.cpuMax = cpuMax;

    const gpuMax = options.value("gpu-max");
    if (gpuMax !== null) overrides.gpuMax = gpuMax;

    const globalMax = options.value("global-max");
    if (globalMax !== null) overrides.globalMax = globalMax;

    const interval = options.value("interval");
    if (interval !== null) overrides.pollIntervalMs = interval;

    const samples = options.value("samples");
    if (samples !== null) overrides.requiredSamples = samples;

    const action = options.value("action");
    if (action !== null) overrides.action = action;

    const apiHost = options.value("api-host");
    if (apiHost !== null) overrides.apiHost = apiHost;

    const apiPort = options.value("api-port");
    if (apiPort !== null) overrides.apiPort = apiPort;

    const logLevel = options.value("log-level");
    if (logLevel !== null) overrides.logLevel = logLevel;

    const stateFile = options.value("state-file");
    if (stateFile !== null) overrides.stateFile = stateFile;

    return { ok: true, overrides };
  } catch (error) {
    if (error instanceof CliUsageError) return { ok: false, message: error.message };
    throw error;
  }
}
