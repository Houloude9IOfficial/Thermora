import { configOverridesToEnvironment, parseConfig, type EnvironmentSource } from "../config/config.js";
import { loadEnvironmentFile } from "../config/env.js";
import { resolvePlatformAdapter, UnsupportedPlatformError } from "../platforms/index.js";
import type { Logger, PlatformAdapter } from "../types.js";
import { describeError } from "../utils/format.js";
import { createLogger } from "../utils/logger.js";
import { environmentFilePath, findProjectRoot, readPackageMetadata } from "../utils/project.js";
import { CliUsageError, Options } from "./args.js";
import { commands, findCommand } from "./commands/index.js";
import { formatHelp } from "./commands/help.js";
import { consoleIo, type CliIo } from "./io.js";
import { readOverrides } from "./overrides.js";
import type { CommandContext } from "./types.js";

export type CliEnvironment = {
  argv: readonly string[];
  io: CliIo;
  environment: EnvironmentSource;
  projectRoot?: string;
};

export async function runCli(argv: readonly string[], io: CliIo = consoleIo): Promise<number> {
  const projectRoot = findProjectRoot();
  loadEnvironmentFile(environmentFilePath(projectRoot));
  return runCliWithEnvironment({ argv, io, environment: process.env, projectRoot });
}

export async function runCliWithEnvironment(environment: CliEnvironment): Promise<number> {
  const { argv, io } = environment;
  const projectRoot = environment.projectRoot ?? findProjectRoot();
  const metadata = readPackageMetadata(projectRoot);

  let options: Options;
  let positionals: string[];
  try {
    const parsed = Options.parse(argv);
    options = parsed.options;
    positionals = parsed.positionals;
  } catch (error) {
    io.writeError(describeError(error));
    return 2;
  }

  const commandName = positionals[0] ?? "help";
  const commandPositionals = positionals.slice(1);

  if (options.has("version") || commandName === "version") {
    io.write(`Thermora v${metadata.version}`);
    return 0;
  }
  if (options.has("help") || commandName === "help") {
    for (const line of formatHelp(metadata.version, commands)) io.write(line);
    return 0;
  }

  const command = findCommand(commandName);
  if (command === null) {
    io.writeError(`Unknown command: ${commandName}`);
    for (const line of formatHelp(metadata.version, commands)) io.writeError(line);
    return 2;
  }

  const overrideResult = readOverrides(options);
  if (!overrideResult.ok) {
    io.writeError(overrideResult.message);
    return 2;
  }

  const mergedEnvironment: EnvironmentSource = {
    ...environment.environment,
    ...configOverridesToEnvironment(overrideResult.overrides),
  };
  const parsedConfig = parseConfig(mergedEnvironment);
  if (!parsedConfig.ok) {
    io.writeError(`Invalid Thermora configuration for ${commandName}:`);
    for (const issue of parsedConfig.issues) io.writeError(`  - ${issue}`);
    return 2;
  }

  const config = parsedConfig.config;
  const logger: Logger = createLogger({ level: config.logLevel });

  let adapter: PlatformAdapter;
  try {
    adapter = resolvePlatformAdapter();
  } catch (error) {
    if (error instanceof UnsupportedPlatformError) {
      io.writeError(error.message);
      return 3;
    }
    throw error;
  }

  const context: CommandContext = {
    options,
    positionals: commandPositionals,
    config,
    logger,
    adapter,
    io,
    projectRoot,
    version: metadata.version,
  };

  try {
    return await command.run(context);
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.writeError(error.message);
      io.writeError(`Usage: ${command.usage}`);
      return 2;
    }
    io.writeError(`${commandName} failed: ${describeError(error)}`);
    return 1;
  }
}
