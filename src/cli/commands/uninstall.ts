import { describeError } from "../../utils/format.js";
import type { CliCommand, CommandContext } from "../types.js";

export const uninstallCommand: CliCommand = {
  name: "uninstall",
  summary: "Remove the Thermora startup integration without touching anything else",
  usage: "thermora uninstall",
  async run(context: CommandContext): Promise<number> {
    try {
      const removal = await context.adapter.uninstallStartup();
      if (removal.removed) {
        context.io.write(`Removed ${removal.serviceName} (${removal.target})`);
      } else {
        context.io.write(`No Thermora startup integration was found (${removal.target})`);
      }
    } catch (error) {
      context.io.writeError(`Could not remove startup integration: ${describeError(error)}`);
      return 1;
    }

    context.io.write("");
    context.io.write("Only the Thermora startup integration was removed. The repository, its build output");
    context.io.write("and the Thermora configuration were left untouched.");
    return 0;
  },
};
