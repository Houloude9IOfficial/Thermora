import type {
  ActionOutcome,
  DiagnosticCheck,
  PlatformAdapter,
  PlatformCapabilities,
  PlatformId,
  PowerAction,
  PowerExecutor,
  StartupContext,
  StartupInstallation,
  StartupRemoval,
  TemperatureReading,
  ThermalLimits,
  ThermalPolicy,
} from "../../src/types.js";
import { buildTemperatureReading } from "../../src/utils/sensors.js";

export function makePolicy(overrides: Partial<ThermalLimits> = {}): ThermalPolicy {
  return {
    limits: { cpuMax: 90, gpuMax: 90, globalMax: 95, requiredSamples: 3, ...overrides },
    action: "shutdown",
  };
}

export function makeReading(
  input: { cpu?: number | null; gpu?: number | null; cores?: readonly number[] } = {},
): TemperatureReading {
  const cpu = input.cpu ?? null;
  const gpu = input.gpu ?? null;
  return buildTemperatureReading({
    cpu: { main: cpu, max: cpu, cores: input.cores ?? [] },
    gpuDevices: gpu === null ? [] : [{ name: "Test GPU", vendor: "Thermora", temperature: gpu }],
  });
}

export function makeSilentReading(): TemperatureReading {
  return buildTemperatureReading({
    cpu: { main: null, max: null, cores: [] },
    gpuDevices: [{ name: "Test GPU", vendor: "Thermora", temperature: -1 }],
  });
}

export class FakeExecutor implements PowerExecutor {
  readonly calls: { action: PowerAction; reason: string }[] = [];
  executed = true;
  dryRun = false;

  async execute(action: PowerAction, reason: string): Promise<ActionOutcome> {
    this.calls.push({ action, reason });
    return {
      action,
      executed: this.executed,
      dryRun: this.dryRun,
      simulated: false,
      message: `fake ${action}`,
    };
  }
}

export class ThrowingExecutor implements PowerExecutor {
  calls = 0;

  async execute(): Promise<ActionOutcome> {
    this.calls += 1;
    throw new Error("power layer exploded");
  }
}

export class FakeAdapter implements PlatformAdapter {
  readonly id: PlatformId;
  readonly name: string;
  readonly capabilities: PlatformCapabilities;
  temperatureCalls = 0;
  concurrentCalls = 0;
  maxConcurrentCalls = 0;
  restartCalls = 0;
  shutdownCalls = 0;
  installCalls = 0;
  uninstallCalls = 0;
  reading: TemperatureReading;
  delayMs: number;
  failures: number;
  restartError: Error | null = null;
  shutdownError: Error | null = null;
  startupContext: StartupContext | null = null;

  constructor(
    options: {
      id?: PlatformId;
      name?: string;
      reading?: TemperatureReading;
      delayMs?: number;
      failures?: number;
      capabilities?: Partial<PlatformCapabilities>;
    } = {},
  ) {
    this.id = options.id ?? "macos";
    this.name = options.name ?? "Fake";
    this.reading = options.reading ?? makeReading({ cpu: 50, gpu: 40 });
    this.delayMs = options.delayMs ?? 0;
    this.failures = options.failures ?? 0;
    this.capabilities = {
      cpuTemperature: true,
      gpuTemperature: true,
      restart: true,
      shutdown: true,
      startup: true,
      ...options.capabilities,
    };
  }

  async getTemperatures(): Promise<TemperatureReading> {
    this.temperatureCalls += 1;
    this.concurrentCalls += 1;
    this.maxConcurrentCalls = Math.max(this.maxConcurrentCalls, this.concurrentCalls);
    try {
      if (this.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      if (this.failures > 0) {
        this.failures -= 1;
        throw new Error("sensor read failed");
      }
      return this.reading;
    } finally {
      this.concurrentCalls -= 1;
    }
  }

  async restart(): Promise<void> {
    this.restartCalls += 1;
    if (this.restartError !== null) throw this.restartError;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1;
    if (this.shutdownError !== null) throw this.shutdownError;
  }

  async installStartup(context: StartupContext): Promise<StartupInstallation> {
    this.installCalls += 1;
    this.startupContext = context;
    return { serviceName: "thermora", target: "fake-target", started: true };
  }

  async uninstallStartup(): Promise<StartupRemoval> {
    this.uninstallCalls += 1;
    return { serviceName: "thermora", target: "fake-target", removed: true };
  }

  async runDiagnostics(): Promise<DiagnosticCheck[]> {
    return [{ name: "fake", status: "ok", detail: "fake adapter" }];
  }
}
