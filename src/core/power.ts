import type { ActionOutcome, Logger, PlatformAdapter, PowerAction, PowerExecutor } from "../types.js";
import { describeError } from "../utils/format.js";

export class DryRunPowerExecutor implements PowerExecutor {
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  execute(action: PowerAction, reason: string): Promise<ActionOutcome> {
    this.logger.warn(`[DRY RUN] Would ${action} system (${reason})`);
    return Promise.resolve({
      action,
      executed: false,
      dryRun: true,
      simulated: false,
      message: `[DRY RUN] Would ${action} system: ${reason}`,
    });
  }
}

export class AdapterPowerExecutor implements PowerExecutor {
  private readonly adapter: PlatformAdapter;
  private readonly logger: Logger;

  constructor(adapter: PlatformAdapter, logger: Logger) {
    this.adapter = adapter;
    this.logger = logger;
  }

  async execute(action: PowerAction, reason: string): Promise<ActionOutcome> {
    this.logger.error(`Executing real power action: ${action} (${reason})`);
    try {
      if (action === "restart") {
        await this.adapter.restart();
      } else {
        await this.adapter.shutdown();
      }
      return {
        action,
        executed: true,
        dryRun: false,
        simulated: false,
        message: `${action} was requested through the ${this.adapter.name} platform integration`,
      };
    } catch (error) {
      const message = describeError(error);
      this.logger.error(`Failed to perform ${action}: ${message}`);
      return { action, executed: false, dryRun: false, simulated: false, message };
    }
  }
}
