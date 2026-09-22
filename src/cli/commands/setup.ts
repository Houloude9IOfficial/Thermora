import { existsSync } from "node:fs";
import { buildDaemonInvocation, compiledEntryPoint, resolveLogDirectory, resolveNpmCommand } from "../../utils/project.js";
import { tryCommand } from "../../utils/exec.js";
import { describeError } from "../../utils/format.js";
import type { CliCommand, CommandContext } from "../types.js";

async function ensureBuilt(context: CommandContext): Promise<boolean> {
  const entryPoint = compiledEntryPoint(context.projectRoot);
  if (existsSync(entryPoint)) return true;

  context.io.write("Thermora is not built yet. Running the production build...");
  const npm = resolveNpmCommand(context.adapter.id);
  const result = await tryCommand(npm, ["run", "build"], { timeoutMs: 600_000 });
  if (!result.ok) {
    context.io.writeError(`Build failed: ${result.error ?? "unknown error"}`);
    return false;
  }
  if (!existsSync(entryPoint)) {
    context.io.writeError(`The build finished but ${entryPoint} is still missing.`);
    return false;
  }
  return true;
}

export const setupCommand: CliCommand = {
  name: "setup",
  summary: "Install Thermora so it starts automatically with this operating system",
  usage: "thermora setup",
  async run(context: CommandContext): Promise<number> {
    if (!context.adapter.capabilities.startup) {
      context.io.writeError(`Startup integration is not available on ${context.adapter.name}`);
      return 1;
    }

    if (!(await ensureBuilt(context))) return 1;

    const invocation = buildDaemonInvocation(context.projectRoot);
    const logDirectory = resolveLogDirectory();

    try {
      const installation = await context.adapter.installStartup({
        projectRoot: context.projectRoot,
        command: invocation.command,
        args: invocation.args,
        logDirectory,
      });
      context.io.write(`Startup integration installed: ${installation.target}`);
      context.io.write(`Command: ${[invocation.command, ...invocation.args].join(" ")}`);
      context.io.write(`Logs: ${logDirectory}`);
    } catch (error) {
      context.io.writeError(`Could not install startup integration: ${describeError(error)}`);
      return 1;
    }

    if (context.config.dryRun) {
      context.io.write("");
      context.io.write("Thermora is currently configured for dry run, so the installed service will not");
      context.io.write("perform real power actions. Set THERMORA_DRY_RUN=false in .env and run setup again");
      context.io.write("to enforce the thermal limits.");
    }

    return 0;
  },
};
