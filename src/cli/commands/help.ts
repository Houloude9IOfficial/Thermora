import type { CliCommand, CommandContext } from "../types.js";

export function formatHelp(version: string, commands: readonly CliCommand[]): string[] {
  const lines: string[] = [
    `Thermora v${version}`,
    "Cross-platform thermal protection daemon for Windows, Linux and macOS",
    "",
    "Usage: thermora <command> [options]",
    "",
    "Commands:",
  ];

  const width = commands.reduce((longest, command) => Math.max(longest, command.name.length), 0);
  for (const command of commands) {
    lines.push(`  ${command.name.padEnd(width)}  ${command.summary}`);
  }

  lines.push(
    "",
    "Options:",
    "  --dry-run / --no-dry-run       Override THERMORA_DRY_RUN",
    "  --cpu-max <c>                  Override THERMORA_CPU_MAX",
    "  --gpu-max <c>                  Override THERMORA_GPU_MAX",
    "  --global-max <c>               Override THERMORA_GLOBAL_MAX",
    "  --interval <ms>                Override THERMORA_POLL_INTERVAL_MS",
    "  --samples <n>                  Override THERMORA_REQUIRED_SAMPLES",
    "  --action <shutdown|restart>    Override THERMORA_ACTION",
    "  --api / --no-api               Override THERMORA_API_ENABLED",
    "  --api-host <host>              Override THERMORA_API_HOST",
    "  --api-port <port>              Override THERMORA_API_PORT",
    "  --log-level <level>            Override THERMORA_LOG_LEVEL",
    "  --state-file <path>            Override THERMORA_STATE_FILE",
    "  --json                         Print machine readable output where supported",
    "  -h, --help                     Show this help",
    "  -v, --version                  Show the Thermora version",
    "",
    "Examples:",
    "  thermora start --dry-run",
    "  thermora sensors",
    "  thermora simulate --cpu 95 --gpu 97",
    "  thermora doctor",
  );

  return lines;
}

export function createHelpCommand(commands: readonly CliCommand[]): CliCommand {
  return {
    name: "help",
    summary: "Show this help",
    usage: "thermora help",
    run(context: CommandContext): Promise<number> {
      for (const line of formatHelp(context.version, commands)) context.io.write(line);
      return Promise.resolve(0);
    },
  };
}

export const versionCommand: CliCommand = {
  name: "version",
  summary: "Show the Thermora version",
  usage: "thermora version",
  run(context: CommandContext): Promise<number> {
    context.io.write(`Thermora v${context.version}`);
    return Promise.resolve(0);
  },
};
