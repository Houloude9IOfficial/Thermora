import { LockError } from "../../core/lock.js";
import { Daemon } from "../../services/daemon.js";
import type { CliCommand, CommandContext } from "../types.js";

export const startCommand: CliCommand = {
  name: "start",
  summary: "Start thermal monitoring in the foreground",
  usage: "thermora start [--dry-run|--no-dry-run] [--interval <ms>] [--samples <n>] [--action shutdown|restart]",
  async run(context: CommandContext): Promise<number> {
    const daemon = new Daemon({
      config: context.config,
      adapter: context.adapter,
      version: context.version,
      projectRoot: context.projectRoot,
      logger: context.logger,
    });

    try {
      await daemon.start();
    } catch (error) {
      if (error instanceof LockError) {
        context.io.writeError(error.message);
        return 1;
      }
      throw error;
    }

    return daemon.exitCode;
  },
};
