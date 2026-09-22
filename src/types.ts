export type PlatformId = "macos" | "windows" | "linux";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type PowerAction = "restart" | "shutdown";

export type ThresholdKind = "cpu" | "gpu" | "global";

export type GpuTemperature = {
  name: string;
  vendor: string | null;
  temperature: number | null;
};

export type CpuTemperature = {
  main: number | null;
  max: number | null;
  cores: number[];
};

export type GpuTemperatureSummary = {
  max: number | null;
  devices: GpuTemperature[];
};

export type TemperatureReading = {
  cpu: CpuTemperature;
  gpu: GpuTemperatureSummary;
  global: {
    max: number | null;
  };
};

export type ThermalLimits = {
  cpuMax: number;
  gpuMax: number;
  globalMax: number;
  requiredSamples: number;
};

export type ThermalPolicy = {
  limits: ThermalLimits;
  action: PowerAction;
};

export type ViolationCounters = Record<ThresholdKind, number>;

export type ThresholdStatus = {
  kind: ThresholdKind;
  label: string;
  temperature: number | null;
  threshold: number;
  count: number;
  required: number;
  exceeded: boolean;
  triggered: boolean;
};

export type EvaluationOutcome = {
  counters: ViolationCounters;
  statuses: ThresholdStatus[];
  action: PowerAction | null;
  reason: string | null;
};

export type ActionOutcome = {
  action: PowerAction;
  executed: boolean;
  dryRun: boolean;
  simulated: boolean;
  message: string;
};

export interface PowerExecutor {
  execute(action: PowerAction, reason: string): Promise<ActionOutcome>;
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  warnOnce(key: string, message: string): void;
  clearOnce(key: string): void;
}

export type PlatformCapabilities = {
  cpuTemperature: boolean;
  gpuTemperature: boolean;
  restart: boolean;
  shutdown: boolean;
  startup: boolean;
};

export type DiagnosticStatus = "ok" | "warn" | "fail";

export type DiagnosticCheck = {
  name: string;
  status: DiagnosticStatus;
  detail: string;
};

export type StartupContext = {
  projectRoot: string;
  command: string;
  args: string[];
  logDirectory: string;
};

export type StartupInstallation = {
  serviceName: string;
  target: string;
  started: boolean;
};

export type StartupRemoval = {
  serviceName: string;
  target: string;
  removed: boolean;
};

export interface PlatformAdapter {
  readonly id: PlatformId;
  readonly name: string;
  readonly capabilities: PlatformCapabilities;
  getTemperatures(): Promise<TemperatureReading>;
  restart(): Promise<void>;
  shutdown(): Promise<void>;
  installStartup(context: StartupContext): Promise<StartupInstallation>;
  uninstallStartup(): Promise<StartupRemoval>;
  runDiagnostics(): Promise<DiagnosticCheck[]>;
}

export type ApiConfig = {
  enabled: boolean;
  host: string;
  port: number;
};

export type ThermoraConfig = {
  cpuMax: number;
  gpuMax: number;
  globalMax: number;
  pollIntervalMs: number;
  requiredSamples: number;
  action: PowerAction;
  dryRun: boolean;
  api: ApiConfig;
  logLevel: LogLevel;
  stateFile: string;
};

export type DaemonPhase = "monitoring" | "action-in-progress";

export type DaemonStatus = "starting" | "monitoring" | "action-in-progress" | "stopped";

export type DaemonStatusSnapshot = {
  pid: number | null;
  status: DaemonStatus;
  phase: DaemonPhase;
  message: string | null;
  version: string;
  platform: string;
  platformId: PlatformId;
  dryRun: boolean;
  action: PowerAction;
  pollIntervalMs: number;
  requiredSamples: number;
  thresholds: {
    cpu: number;
    gpu: number;
    global: number;
  };
  apiEnabled: boolean;
  startedAt: string;
  updatedAt: string;
  cycles: number;
  reading: TemperatureReading | null;
  violations: ThresholdStatus[];
  lastAction: ActionOutcome | null;
  lastError: string | null;
};
