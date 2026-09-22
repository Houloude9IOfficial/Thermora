import { buildStatusReport, formatStatusReport } from "../../services/report.js";
import { readDaemonSnapshot } from "../../services/daemon.js";
import { writeLines } from "../io.js";
import type { CliCommand, CommandContext } from "../types.js";

export const statusCommand: CliCommand = {
  name: "status",
  summary: "Show configuration, daemon status, thresholds and current temperatures",
  usage: "thermora status [--json]",
  async run(context: CommandContext): Promise<number> {
    const snapshot = readDaemonSnapshot(context.config);
    const report = await buildStatusReport({
      config: context.config,
      adapter: context.adapter,
      version: context.version,
      snapshot,
    });

    if (context.options.has("json")) {
      context.io.write(JSON.stringify(report, null, 2));
      return 0;
    }

    writeLines(context.io, formatStatusReport(report));
    return 0;
  },
};
