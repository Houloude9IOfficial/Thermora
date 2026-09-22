import type {
  ActionOutcome,
  Logger,
  PowerAction,
  PowerExecutor,
  TemperatureReading,
  ThermalPolicy,
  ThresholdStatus,
  ViolationCounters,
} from "../types.js";
import { formatTemperature } from "../utils/format.js";
import { hasTemperatureData } from "../utils/sensors.js";
import { createViolationCounters, evaluateReading } from "./evaluator.js";
import type { ActionLock } from "./state.js";

export type CycleSkipReason = "action-in-progress";

export type CycleResult = {
  reading: TemperatureReading;
  statuses: ThresholdStatus[];
  counters: ViolationCounters;
  action: PowerAction | null;
  reason: string | null;
  actionOutcome: ActionOutcome | null;
  skipped: CycleSkipReason | null;
  incidentActive: boolean;
};

export type ThermalEngineOptions = {
  policy: ThermalPolicy;
  lock: ActionLock;
  executor: PowerExecutor;
  logger: Logger;
};

export class ThermalEngine {
  private readonly options: ThermalEngineOptions;
  private counters: ViolationCounters = createViolationCounters();
  private incidentActive = false;

  constructor(options: ThermalEngineOptions) {
    this.options = options;
  }

  get countersSnapshot(): ViolationCounters {
    return { ...this.counters };
  }

  async processReading(reading: TemperatureReading): Promise<CycleResult> {
    const { lock, logger, policy } = this.options;

    if (lock.locked) {
      return {
        reading,
        statuses: [],
        counters: this.countersSnapshot,
        action: null,
        reason: null,
        actionOutcome: null,
        skipped: "action-in-progress",
        incidentActive: this.incidentActive,
      };
    }

    const outcome = evaluateReading(reading, policy, this.counters);
    this.counters = outcome.counters;
    if (outcome.statuses.every((status) => !status.exceeded)) this.incidentActive = false;

    this.reportSensorHealth(reading);
    this.reportViolations(outcome.statuses);

    const base: CycleResult = {
      reading,
      statuses: outcome.statuses,
      counters: this.countersSnapshot,
      action: null,
      reason: null,
      actionOutcome: null,
      skipped: null,
      incidentActive: this.incidentActive,
    };

    if (outcome.action === null || outcome.reason === null) return base;
    if (this.incidentActive) return base;
    if (!lock.acquire()) return { ...base, skipped: "action-in-progress" };

    logger.error(`CRITICAL: ${outcome.reason}`);
    let actionOutcome: ActionOutcome;
    try {
      actionOutcome = await this.options.executor.execute(outcome.action, outcome.reason);
    } catch (error) {
      lock.release();
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Power action failed: ${message}`);
      return {
        ...base,
        action: outcome.action,
        reason: outcome.reason,
        actionOutcome: {
          action: outcome.action,
          executed: false,
          dryRun: false,
          simulated: false,
          message,
        },
      };
    }

    if (!actionOutcome.executed) lock.release();
    this.incidentActive = true;

    return {
      ...base,
      action: outcome.action,
      reason: outcome.reason,
      actionOutcome,
    };
  }

  private reportViolations(statuses: readonly ThresholdStatus[]): void {
    for (const status of statuses) {
      if (!status.exceeded) continue;
      if (status.triggered) continue;
      const progress = `${status.count}/${status.required}`;
      if (status.count === 1) {
        this.options.logger.warn(
          `${status.label} at ${formatTemperature(status.temperature)} exceeds the ${status.threshold} C limit (violation ${progress})`,
        );
        continue;
      }
      this.options.logger.debug(
        `${status.label} at ${formatTemperature(status.temperature)} still above the ${status.threshold} C limit (violation ${progress})`,
      );
    }
  }

  private reportSensorHealth(reading: TemperatureReading): void {
    const logger = this.options.logger;
    const cpuAvailable = reading.cpu.max !== null || reading.cpu.cores.length > 0;

    if (cpuAvailable) logger.clearOnce("cpu-temperature");
    else logger.warnOnce("cpu-temperature", "CPU temperature sensors are unavailable on this system");

    if (reading.gpu.max !== null) logger.clearOnce("gpu-temperature");
    else logger.warnOnce("gpu-temperature", "GPU temperature sensors are unavailable on this system");

    if (hasTemperatureData(reading)) {
      logger.clearOnce("no-temperature");
      return;
    }
    logger.warnOnce(
      "no-temperature",
      "No usable temperature sensor is available. Thermora is not protecting this machine right now.",
    );
  }
}
