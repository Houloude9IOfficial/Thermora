import type {
  ActionOutcome,
  DaemonPhase,
  DaemonStatus,
  DaemonStatusSnapshot,
  PlatformId,
  PowerAction,
  TemperatureReading,
  ThermalLimits,
  ThresholdStatus,
} from "../types.js";

export class ActionLock {
  private currentPhase: DaemonPhase = "monitoring";

  get phase(): DaemonPhase {
    return this.currentPhase;
  }

  get locked(): boolean {
    return this.currentPhase === "action-in-progress";
  }

  acquire(): boolean {
    if (this.currentPhase === "action-in-progress") return false;
    this.currentPhase = "action-in-progress";
    return true;
  }

  release(): void {
    this.currentPhase = "monitoring";
  }
}

export type DaemonStateInit = {
  version: string;
  platform: string;
  platformId: PlatformId;
  dryRun: boolean;
  action: PowerAction;
  pollIntervalMs: number;
  requiredSamples: number;
  limits: ThermalLimits;
  apiEnabled: boolean;
};

export class DaemonState {
  private readonly state: DaemonStatusSnapshot;

  constructor(init: DaemonStateInit) {
    const now = new Date().toISOString();
    this.state = {
      pid: process.pid,
      status: "starting",
      phase: "monitoring",
      message: null,
      version: init.version,
      platform: init.platform,
      platformId: init.platformId,
      dryRun: init.dryRun,
      action: init.action,
      pollIntervalMs: init.pollIntervalMs,
      requiredSamples: init.requiredSamples,
      thresholds: { cpu: init.limits.cpuMax, gpu: init.limits.gpuMax, global: init.limits.globalMax },
      apiEnabled: init.apiEnabled,
      startedAt: now,
      updatedAt: now,
      cycles: 0,
      reading: null,
      violations: [],
      lastAction: null,
      lastError: null,
    };
  }

  get cycles(): number {
    return this.state.cycles;
  }

  setStatus(status: DaemonStatus, message: string | null = null): void {
    this.state.status = status;
    this.state.message = message;
    this.touch();
  }

  setPhase(phase: DaemonPhase): void {
    this.state.phase = phase;
    if (this.state.status !== "stopped" && this.state.status !== "starting") {
      this.state.status = phase === "action-in-progress" ? "action-in-progress" : "monitoring";
    }
    this.touch();
  }

  recordCycle(reading: TemperatureReading, statuses: ThresholdStatus[]): void {
    this.state.cycles += 1;
    this.state.reading = reading;
    this.state.violations = statuses.map((status) => ({ ...status }));
    this.touch();
  }

  recordAction(outcome: ActionOutcome): void {
    this.state.lastAction = { ...outcome };
    this.touch();
  }

  recordError(message: string): void {
    this.state.lastError = message;
    this.touch();
  }

  snapshot(): DaemonStatusSnapshot {
    return {
      ...this.state,
      reading: this.state.reading === null ? null : structuredClone(this.state.reading),
      violations: this.state.violations.map((status) => ({ ...status })),
      lastAction: this.state.lastAction === null ? null : { ...this.state.lastAction },
      thresholds: { ...this.state.thresholds },
    };
  }

  private touch(): void {
    this.state.updatedAt = new Date().toISOString();
  }
}
