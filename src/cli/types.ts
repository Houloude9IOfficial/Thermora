import type { ThermoraConfig, Logger, PlatformAdapter } from "../types.js";
import type { Options } from "./args.js";
import type { CliIo } from "./io.js";

export type CommandContext = {
  options: Options;
  positionals: string[];
  config: ThermoraConfig;
  logger: Logger;
  adapter: PlatformAdapter;
  io: CliIo;
  projectRoot: string;
  version: string;
};

export type CliCommand = {
  name: string;
  summary: string;
  usage: string;
  run(context: CommandContext): Promise<number>;
};
