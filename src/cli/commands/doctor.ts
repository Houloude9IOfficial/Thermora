import { probeStateFileWritable } from "../../core/stateFile.js";
import { buildDoctorReport, formatDoctorReport } from "../../services/report.js";
import { compiledEntryPoint } from "../../utils/project.js";
import { existsSync } from "node:fs";
import { writeLines } from "../io.js";
import type { CliCommand, CommandContext } from "../types.js";

export const doctorCommand: CliCommand = {
  name: "doctor",
  summary: "Check platform support, sensors, native tools, permissions and startup integration",
  usage: "thermora doctor [--json]",
  async run(context: CommandContext): Promise<number> {
    const report = await buildDoctorReport({
      config: context.config,
      adapter: context.adapter,
      version: context.version,
      entryPointExists: existsSync(compiledEntryPoint(context.projectRoot)),
      stateFileWritable: probeStateFileWritable(context.config.stateFile),
    });

    if (context.options.has("json")) {
      context.io.write(JSON.stringify(report, null, 2));
    } else {
      writeLines(context.io, formatDoctorReport(report));
    }

    return report.summary.fail > 0 ? 1 : 0;
  },
};
