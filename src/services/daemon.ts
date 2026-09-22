import { ApiServer } from "../api/server.js";
import { toThermalPolicy } from "../config/config.js";
import type { CycleResult } from "../core/engine.js";
import { ThermalEngine } from "../core/engine.js";
import { DaemonLock, LockError } from "../core/lock.js";
import { Monitor } from "../core/monitor.js";
import { AdapterPowerExecutor, DryRunPowerExecutor } from "../core/power.js";
import { ActionLock, DaemonState } from "../core/state.js";
import { readStateSnapshot, removeStateSnapshot, writeStateSnapshot } from "../core/stateFile.js";
import type { DaemonStatusSnapshot, Logger, PlatformAdapter, PowerExecutor, ThermoraConfig } from "../types.js";
import { describeError, describeReading } from "../utils/format.js";
import { resolveLockFilePath } from "../config/config.js";
import { hasTemperatureData } from "../utils/sensors.js";

export type DaemonOptions = {
  config: ThermoraConfig;
  adapter: PlatformAdapter;
  version: string;
  projectRoot: string;
  logger: Logger;
};

export class Daemon {
  private readonly config: ThermoraConfig;
  private readonly adapter: PlatformAdapter;
  private readonly logger: Logger;
  private readonly version: string;
  private readonly actionLock = new ActionLock();
  private readonly state: DaemonState;
  private readonly engine: ThermalEngine;
  private readonly monitor: Monitor;
  private readonly api: ApiServer | null;
  private readonly stopPromise: Promise<void>;
  private stopResolve: (() => void) | null = null;
  private lock: DaemonLock | null = null;
  private stopped = false;
  private exitCodeValue = 0;

  constructor(options: DaemonOptions) {
    this.config = options.config;
    this.adapter = options.adapter;
    this.logger = options.logger;
    this.version = options.version;

    const policy = toThermalPolicy(this.config);
    this.state = new DaemonState({
      version: options.version,
      platform: this.adapter.name,
      platformId: this.adapter.id,
      dryRun: this.config.dryRun,
      action: this.config.action,
      pollIntervalMs: this.config.pollIntervalMs,
      requiredSamples: this.config.requiredSamples,
      limits: policy.limits,
      apiEnabled: this.config.api.enabled,
    });

    const executor: PowerExecutor = this.config.dryRun
      ? new DryRunPowerExecutor(this.logger)
      : new AdapterPowerExecutor(this.adapter, this.logger);

    this.engine = new ThermalEngine({
      policy,
      lock: this.actionLock,
      executor,
      logger: this.logger,
    });

    this.monitor = new Monitor({
      adapter: this.adapter,
      engine: this.engine,
      logger: this.logger,
      pollIntervalMs: this.config.pollIntervalMs,
      onCycle: (result: CycleResult): void => this.handleCycle(result),
    });

    this.api = this.config.api.enabled
      ? new ApiServer({
          host: this.config.api.host,
          port: this.config.api.port,
          state: this.state,
          logger: this.logger,
          version: options.version,
          platform: this.adapter.name,
        })
      : null;

    this.stopPromise = new Promise<void>((resolve) => {
      this.stopResolve = resolve;
    });
  }

  get exitCode(): number {
    return this.exitCodeValue;
  }

  get stateSnapshot(): DaemonStatusSnapshot {
    return this.state.snapshot();
  }

  async start(): Promise<void> {
    this.lock = DaemonLock.acquire(resolveLockFilePath(this.config.stateFile));

    this.logger.info(`Thermora v${this.version} starting on ${this.adapter.name} (pid ${process.pid})`);
    this.logger.info(`Mode: ${this.config.dryRun ? "DRY RUN (no real power actions)" : "ENFORCING (real power actions enabled)"}`);
    this.logger.info(
      `Limits: CPU ${this.config.cpuMax} C, GPU ${this.config.gpuMax} C, global ${this.config.globalMax} C, ${this.config.requiredSamples} consecutive sample(s), action ${this.config.action}`,
    );
    this.logger.info(`Poll interval: ${this.config.pollIntervalMs} ms`);

    this.registerSignalHandlers();

    if (this.config.api.enabled && this.api !== null) {
      try {
        const address = await this.api.start();
        this.logger.info(`API listening on http://${address.host}:${address.port}`);
      } catch (error) {
        this.logger.error(`API server failed to start: ${describeError(error)}`);
      }
    }

    await this.probeSensors();

    this.state.setStatus("monitoring");
    this.writeState();
    this.monitor.start();

    await this.stopPromise;
  }

  async stop(reason: string): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    this.logger.info(`Stopping Thermora: ${reason}`);
    this.state.setStatus("stopped", reason);
    this.writeState();

    await this.monitor.stop();

    if (this.api !== null) {
      try {
        await this.api.stop();
      } catch (error) {
        this.logger.warn(`API server did not shut down cleanly: ${describeError(error)}`);
      }
    }

    this.removeSignalHandlers();
    this.lock?.release();
    this.lock = null;
    removeStateSnapshot(this.config.stateFile);

    const resolve = this.stopResolve;
    this.stopResolve = null;
    if (resolve !== null) resolve();
  }

  private async probeSensors(): Promise<void> {
    try {
      const reading = await this.adapter.getTemperatures();
      this.state.recordCycle(reading, []);
      if (!hasTemperatureData(reading)) {
        this.logger.error(
          "No usable temperature sensor was detected. Thermora cannot protect this machine until a sensor becomes readable.",
        );
        return;
      }
      this.logger.info(`Sensors ready: ${describeReading(reading)}`);
    } catch (error) {
      this.logger.error(`Initial sensor probe failed: ${describeError(error)}`);
    }
  }

  private handleCycle(result: CycleResult): void {
    if (result.skipped === "action-in-progress") {
      this.state.setPhase("action-in-progress");
    } else {
      this.state.setPhase(this.actionLock.phase);
    }

    this.state.recordCycle(result.reading, result.statuses);

    if (result.actionOutcome !== null) {
      this.state.recordAction(result.actionOutcome);
      if (result.actionOutcome.executed) {
        this.logger.warn(`${this.config.action} was requested and the operating system is taking over`);
      }
    }

    this.writeState();
  }

  private writeState(): void {
    try {
      writeStateSnapshot(this.config.stateFile, this.state.snapshot());
    } catch (error) {
      this.logger.warnOnce("state-file", `Could not write the Thermora state file: ${describeError(error)}`);
    }
  }

  private readonly handleSignal = (signal: NodeJS.Signals): void => {
    void this.stop(`received ${signal}`);
  };

  private registerSignalHandlers(): void {
    process.on("SIGINT", this.handleSignal);
    process.on("SIGTERM", this.handleSignal);
  }

  private removeSignalHandlers(): void {
    process.off("SIGINT", this.handleSignal);
    process.off("SIGTERM", this.handleSignal);
  }
}

export function readDaemonSnapshot(config: ThermoraConfig): DaemonStatusSnapshot | null {
  return readStateSnapshot(config.stateFile);
}

export { LockError };
