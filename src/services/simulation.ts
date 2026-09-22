import { ThermalEngine, type CycleResult } from "../core/engine.js";
import { ActionLock } from "../core/state.js";
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
import { buildTemperatureReading } from "../utils/sensors.js";

export class SimulationPowerExecutor implements PowerExecutor {
  private readonly logger: Logger;
  private readonly outcomes: ActionOutcome[] = [];

  constructor(logger: Logger) {
    this.logger = logger;
  }

  get actions(): readonly ActionOutcome[] {
    return this.outcomes;
  }

  execute(action: PowerAction, reason: string): Promise<ActionOutcome> {
    const outcome: ActionOutcome = {
      action,
      executed: false,
      dryRun: false,
      simulated: true,
      message: `[SIMULATION] Would ${action} system: ${reason}`,
    };
    this.outcomes.push(outcome);
    this.logger.info(`[SIMULATION] Would ${action} system (${reason})`);
    return Promise.resolve(outcome);
  }
}

export type SimulationOptions = {
  policy: ThermalPolicy;
  cycles: number;
  cpu: number | null;
  gpu: number | null;
  logger: Logger;
};

export type SimulationCycle = {
  index: number;
  reading: TemperatureReading;
  statuses: ThresholdStatus[];
  counters: ViolationCounters;
  action: PowerAction | null;
  reason: string | null;
};

export type SimulationResult = {
  reading: TemperatureReading;
  cycles: SimulationCycle[];
  action: PowerAction | null;
  reason: string | null;
  executed: boolean;
  simulated: boolean;
};

export function buildSimulatedReading(input: { cpu: number | null; gpu: number | null }): TemperatureReading {
  return buildTemperatureReading({
    cpu: {
      main: input.cpu,
      max: input.cpu,
      cores: input.cpu === null ? [] : [input.cpu],
    },
    gpuDevices:
      input.gpu === null
        ? []
        : [{ name: "Simulated GPU", vendor: "Thermora", temperature: input.gpu }],
  });
}

export async function runSimulation(options: SimulationOptions): Promise<SimulationResult> {
  const lock = new ActionLock();
  const executor = new SimulationPowerExecutor(options.logger);
  const engine = new ThermalEngine({
    policy: options.policy,
    lock,
    executor,
    logger: options.logger,
  });

  const reading = buildSimulatedReading({ cpu: options.cpu, gpu: options.gpu });
  const cycles: SimulationCycle[] = [];

  for (let index = 0; index < options.cycles; index += 1) {
    const result: CycleResult = await engine.processReading(reading);
    cycles.push({
      index: index + 1,
      reading: result.reading,
      statuses: result.statuses,
      counters: result.counters,
      action: result.action,
      reason: result.reason,
    });
  }

  const decision = cycles.find((cycle) => cycle.action !== null) ?? null;

  return {
    reading,
    cycles,
    action: decision?.action ?? null,
    reason: decision?.reason ?? null,
    executed: executor.actions.some((outcome) => outcome.executed),
    simulated: executor.actions.length > 0,
  };
}
