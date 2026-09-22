import type { Logger, PlatformAdapter, TemperatureReading } from "../types.js";
import type { CycleResult, ThermalEngine } from "./engine.js";
import { describeError } from "../utils/format.js";

export type MonitorOptions = {
  adapter: PlatformAdapter;
  engine: ThermalEngine;
  logger: Logger;
  pollIntervalMs: number;
  onCycle?: (result: CycleResult) => void;
};

export class Monitor {
  private readonly options: MonitorOptions;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private wake: (() => void) | null = null;
  private loop: Promise<void> | null = null;

  constructor(options: MonitorOptions) {
    this.options = options;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const wake = this.wake;
    this.wake = null;
    if (wake !== null) wake();
    if (this.loop !== null) {
      await this.loop;
      this.loop = null;
    }
  }

  async runCycle(): Promise<CycleResult> {
    const reading: TemperatureReading = await this.options.adapter.getTemperatures();
    return this.options.engine.processReading(reading);
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.runCycle();
        this.options.onCycle?.(result);
      } catch (error) {
        this.options.logger.error(`Monitoring cycle failed: ${describeError(error)}`);
      }
      if (!this.running) break;
      await this.wait(this.options.pollIntervalMs);
    }
  }

  private wait(durationMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        this.wake = null;
        this.timer = null;
        resolve();
      };
      this.wake = finish;
      this.timer = setTimeout(finish, durationMs);
    });
  }
}
