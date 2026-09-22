import type {
  DaemonStatus,
  DaemonStatusSnapshot,
  DiagnosticCheck,
  PlatformAdapter,
  PlatformId,
  PowerAction,
  TemperatureReading,
  ThermoraConfig,
  ThresholdStatus,
} from "../types.js";
import { isProcessAlive } from "../core/lock.js";
import { SUPPORTED_PLATFORMS } from "../platforms/index.js";
import { isLoopbackHost } from "../config/config.js";
import { describeError, formatTemperature, formatTimestamp, UNAVAILABLE } from "../utils/format.js";
import { hasTemperatureData } from "../utils/sensors.js";
import type { SimulationResult } from "./simulation.js";

export type DaemonRuntime = {
  running: boolean;
  stale: boolean;
  pid: number | null;
  status: DaemonStatus | null;
  message: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  cycles: number;
};

export function describeDaemonRuntime(snapshot: DaemonStatusSnapshot | null): DaemonRuntime {
  if (snapshot === null) {
    return {
      running: false,
      stale: false,
      pid: null,
      status: null,
      message: null,
      startedAt: null,
      updatedAt: null,
      cycles: 0,
    };
  }
  const pid = snapshot.pid;
  const alive = pid !== null && isProcessAlive(pid);
  return {
    running: alive,
    stale: !alive,
    pid,
    status: snapshot.status,
    message: snapshot.message,
    startedAt: snapshot.startedAt,
    updatedAt: snapshot.updatedAt,
    cycles: snapshot.cycles,
  };
}

export type StatusReport = {
  version: string;
  platform: string;
  platformId: PlatformId;
  mode: string;
  dryRun: boolean;
  action: PowerAction;
  pollIntervalMs: number;
  requiredSamples: number;
  thresholds: { cpu: number; gpu: number; global: number };
  api: { enabled: boolean; host: string; port: number };
  daemon: DaemonRuntime;
  reading: TemperatureReading | null;
  readingError: string | null;
  violations: ThresholdStatus[];
};

export async function buildStatusReport(options: {
  config: ThermoraConfig;
  adapter: PlatformAdapter;
  version: string;
  snapshot: DaemonStatusSnapshot | null;
}): Promise<StatusReport> {
  const { config, adapter } = options;
  let reading: TemperatureReading | null = null;
  let readingError: string | null = null;

  try {
    reading = await adapter.getTemperatures();
  } catch (error) {
    readingError = describeError(error);
  }

  return {
    version: options.version,
    platform: adapter.name,
    platformId: adapter.id,
    mode: config.dryRun ? "DRY RUN" : "ENFORCING",
    dryRun: config.dryRun,
    action: config.action,
    pollIntervalMs: config.pollIntervalMs,
    requiredSamples: config.requiredSamples,
    thresholds: { cpu: config.cpuMax, gpu: config.gpuMax, global: config.globalMax },
    api: { enabled: config.api.enabled, host: config.api.host, port: config.api.port },
    daemon: describeDaemonRuntime(options.snapshot),
    reading,
    readingError,
    violations: options.snapshot?.violations ?? [],
  };
}

function describeDaemonLine(runtime: DaemonRuntime): string {
  if (runtime.running) {
    const since = runtime.startedAt === null ? UNAVAILABLE : formatTimestamp(runtime.startedAt);
    return `running (pid ${runtime.pid}, started ${since}, cycles ${runtime.cycles})`;
  }
  if (runtime.stale) {
    return `stale state file from pid ${runtime.pid}; no Thermora monitor is running`;
  }
  return "not running";
}

export function formatStatusReport(report: StatusReport): string[] {
  const lines: string[] = [
    `Thermora v${report.version}`,
    `Platform: ${report.platform} (${report.platformId})`,
    `Mode: ${report.mode}`,
    "",
    "Configuration",
    `  Action: ${report.action}`,
    `  Poll interval: ${report.pollIntervalMs} ms`,
    `  Required samples: ${report.requiredSamples}`,
    `  CPU limit: ${report.thresholds.cpu} C`,
    `  GPU limit: ${report.thresholds.gpu} C`,
    `  Global limit: ${report.thresholds.global} C`,
    `  API: ${report.api.enabled ? `enabled on ${report.api.host}:${report.api.port}` : "disabled"}`,
    "",
    "Daemon",
    `  Status: ${describeDaemonLine(report.daemon)}`,
  ];

  if (report.daemon.message !== null) lines.push(`  Message: ${report.daemon.message}`);

  lines.push("", "Temperatures");

  if (report.reading === null) {
    lines.push(`  Unavailable: ${report.readingError ?? "no reading"}`);
  } else {
    lines.push(`  CPU main: ${formatTemperature(report.reading.cpu.main)}`);
    lines.push(`  CPU max: ${formatTemperature(report.reading.cpu.max)}`);
    lines.push(`  CPU cores: ${report.reading.cpu.cores.length}`);
    lines.push(`  GPU max: ${formatTemperature(report.reading.gpu.max)}`);
    lines.push(`  Global max: ${formatTemperature(report.reading.global.max)}`);
  }

  const active = report.violations.filter((status) => status.exceeded);
  lines.push("", "Active violations");
  if (active.length === 0) {
    lines.push("  none");
  } else {
    for (const status of active) {
      lines.push(
        `  ${status.label}: ${formatTemperature(status.temperature)} against ${status.threshold} C (${status.count}/${status.required})`,
      );
    }
  }

  return lines;
}

export function formatSensorReport(reading: TemperatureReading): string[] {
  const lines: string[] = [
    "CPU",
    `  main: ${formatTemperature(reading.cpu.main)}`,
    `  max: ${formatTemperature(reading.cpu.max)}`,
  ];

  if (reading.cpu.cores.length === 0) {
    lines.push("  cores: none reported");
  } else {
    for (const [index, temperature] of reading.cpu.cores.entries()) {
      lines.push(`  core ${index + 1}: ${formatTemperature(temperature)}`);
    }
  }

  lines.push("", "GPU");
  if (reading.gpu.devices.length === 0) {
    lines.push("  no GPU device reported");
  } else {
    for (const device of reading.gpu.devices) {
      const vendor = device.vendor === null ? "unknown vendor" : device.vendor;
      lines.push(`  ${device.name} (${vendor}): ${formatTemperature(device.temperature)}`);
    }
  }
  lines.push(`  max: ${formatTemperature(reading.gpu.max)}`);

  lines.push("", `Global max: ${formatTemperature(reading.global.max)}`);
  if (!hasTemperatureData(reading)) {
    lines.push("", "No usable temperature sensor is currently readable on this system.");
  }

  return lines;
}

export type DoctorReport = {
  checks: DiagnosticCheck[];
  summary: { ok: number; warn: number; fail: number };
  platform: string;
  version: string;
};

export async function buildDoctorReport(options: {
  config: ThermoraConfig;
  adapter: PlatformAdapter;
  version: string;
  entryPointExists: boolean;
  stateFileWritable: boolean;
}): Promise<DoctorReport> {
  const { config, adapter } = options;
  const checks: DiagnosticCheck[] = [];

  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push(
    nodeMajor >= 22
      ? { name: "Node.js runtime", status: "ok", detail: `v${process.versions.node}` }
      : {
          name: "Node.js runtime",
          status: "fail",
          detail: `v${process.versions.node} is not supported; Node.js 22 or newer is required`,
        },
  );

  checks.push(
    SUPPORTED_PLATFORMS.includes(adapter.id)
      ? { name: "Supported operating system", status: "ok", detail: `${adapter.name} (${adapter.id})` }
      : { name: "Supported operating system", status: "fail", detail: `${adapter.id} is not supported` },
  );

  checks.push({
    name: "Configuration",
    status: "ok",
    detail: `CPU ${config.cpuMax} C, GPU ${config.gpuMax} C, global ${config.globalMax} C, ${config.requiredSamples} consecutive sample(s), action ${config.action}`,
  });

  checks.push(
    config.dryRun
      ? {
          name: "Power actions",
          status: "ok",
          detail: "dry run is enabled, so no real shutdown or restart is executed",
        }
      : {
          name: "Power actions",
          status: "warn",
          detail: "enforcing mode is enabled; a real shutdown or restart is executed when a limit is exceeded",
        },
  );

  checks.push(
    options.entryPointExists
      ? { name: "Production build", status: "ok", detail: "dist/index.js is present" }
      : {
          name: "Production build",
          status: "warn",
          detail: 'dist/index.js is missing; run "npm run build" before "thermora setup"',
        },
  );

  checks.push(
    options.stateFileWritable
      ? { name: "State file", status: "ok", detail: config.stateFile }
      : { name: "State file", status: "fail", detail: `cannot write ${config.stateFile}` },
  );

  if (config.api.enabled) {
    checks.push(
      isLoopbackHost(config.api.host)
        ? {
            name: "Local API",
            status: "ok",
            detail: `bound to loopback ${config.api.host}:${config.api.port}`,
          }
        : {
            name: "Local API",
            status: "warn",
            detail: `${config.api.host}:${config.api.port} is reachable from outside this machine; restrict access to the port`,
          },
    );
  } else {
    checks.push({ name: "Local API", status: "ok", detail: "disabled" });
  }

  try {
    checks.push(...(await adapter.runDiagnostics()));
  } catch (error) {
    checks.push({ name: "Platform diagnostics", status: "fail", detail: describeError(error) });
  }

  try {
    const reading = await adapter.getTemperatures();
    checks.push(
      hasTemperatureData(reading)
        ? { name: "Usable thermal sensors", status: "ok", detail: "at least one temperature sensor is readable" }
        : {
            name: "Usable thermal sensors",
            status: "fail",
            detail: "no usable temperature sensor is readable, so Thermora cannot protect this machine",
          },
    );
  } catch (error) {
    checks.push({ name: "Usable thermal sensors", status: "fail", detail: describeError(error) });
  }

  const summary = { ok: 0, warn: 0, fail: 0 };
  for (const check of checks) summary[check.status] += 1;

  return { checks, summary, platform: adapter.name, version: options.version };
}

export function formatDoctorReport(report: DoctorReport): string[] {
  const lines: string[] = [`Thermora doctor`, `Platform: ${report.platform}`, ""];
  for (const check of report.checks) {
    lines.push(`[${check.status}] ${check.name}: ${check.detail}`);
  }
  lines.push("");
  lines.push(`Result: ${report.summary.ok} ok, ${report.summary.warn} warning(s), ${report.summary.fail} failure(s)`);
  return lines;
}

export function formatSimulationReport(result: SimulationResult): string[] {
  const lines: string[] = ["SIMULATION MODE", "", "Cycles"];

  for (const cycle of result.cycles) {
    const temperatures = `CPU ${formatTemperature(cycle.reading.cpu.max)} | GPU ${formatTemperature(cycle.reading.gpu.max)} | Global ${formatTemperature(cycle.reading.global.max)}`;
    const exceeded = cycle.statuses.filter((status) => status.exceeded);
    const progress =
      exceeded.length === 0
        ? "within all limits"
        : exceeded
            .map((status) => `${status.label} violation ${status.count}/${status.required}`)
            .join(", ");
    lines.push(`  ${cycle.index}: ${temperatures} | ${progress}`);
  }

  lines.push("");
  if (result.reason === null) {
    lines.push("No threshold was exceeded for the configured number of consecutive samples.");
  } else {
    lines.push(result.reason);
  }

  lines.push("");
  if (result.action === null) {
    lines.push("Would perform no power action");
  } else {
    lines.push(`Would ${result.action}`);
  }
  lines.push(
    result.executed
      ? "A system action was executed"
      : "No system action executed",
  );
  return lines;
}
