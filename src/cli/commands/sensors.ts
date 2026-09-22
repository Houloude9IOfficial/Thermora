import { formatSensorReport } from "../../services/report.js";
import type { TemperatureReading } from "../../types.js";
import { describeError } from "../../utils/format.js";
import { writeLines } from "../io.js";
import type { CliCommand, CommandContext } from "../types.js";

export const sensorsCommand: CliCommand = {
  name: "sensors",
  summary: "Print the normalized temperature sensors available on this machine",
  usage: "thermora sensors [--json]",
  async run(context: CommandContext): Promise<number> {
    let reading: TemperatureReading;
    try {
      reading = await context.adapter.getTemperatures();
    } catch (error) {
      context.io.writeError(`Could not read temperature sensors: ${describeError(error)}`);
      return 1;
    }

    if (context.options.has("json")) {
      context.io.write(
        JSON.stringify({ platform: context.adapter.name, platformId: context.adapter.id, reading }, null, 2),
      );
      return 0;
    }

    context.io.write(`Platform: ${context.adapter.name}`);
    context.io.write("");
    writeLines(context.io, formatSensorReport(reading));
    return 0;
  },
};
