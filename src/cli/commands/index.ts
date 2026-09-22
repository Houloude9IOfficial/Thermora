import { doctorCommand } from "./doctor.js";
import { createHelpCommand, versionCommand } from "./help.js";
import { sensorsCommand } from "./sensors.js";
import { setupCommand } from "./setup.js";
import { simulateCommand } from "./simulate.js";
import { startCommand } from "./start.js";
import { statusCommand } from "./status.js";
import { uninstallCommand } from "./uninstall.js";
import type { CliCommand } from "../types.js";

const primaryCommands: readonly CliCommand[] = [
  startCommand,
  statusCommand,
  sensorsCommand,
  simulateCommand,
  setupCommand,
  uninstallCommand,
  doctorCommand,
];

export const commands: readonly CliCommand[] = [
  ...primaryCommands,
  createHelpCommand(primaryCommands),
  versionCommand,
];

export function findCommand(name: string): CliCommand | null {
  return commands.find((command) => command.name === name) ?? null;
}
