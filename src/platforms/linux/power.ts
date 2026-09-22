import type { DiagnosticCheck } from "../../types.js";
import { findExecutable, runCommand } from "../../utils/exec.js";

const SYSTEMCTL_CANDIDATES = ["/usr/bin/systemctl", "/bin/systemctl"];
const SHUTDOWN_CANDIDATES = ["/usr/sbin/shutdown", "/sbin/shutdown", "/usr/bin/shutdown", "/bin/shutdown"];

export function resolvePowerCommand(): { command: string; args: string[] } | null {
  const systemctl = findExecutable(SYSTEMCTL_CANDIDATES);
  if (systemctl !== null) return { command: systemctl, args: ["poweroff"] };
  const shutdown = findExecutable(SHUTDOWN_CANDIDATES);
  if (shutdown !== null) return { command: shutdown, args: ["-h", "now"] };
  return null;
}

export function resolveRestartCommand(): { command: string; args: string[] } | null {
  const systemctl = findExecutable(SYSTEMCTL_CANDIDATES);
  if (systemctl !== null) return { command: systemctl, args: ["reboot"] };
  const shutdown = findExecutable(SHUTDOWN_CANDIDATES);
  if (shutdown !== null) return { command: shutdown, args: ["-r", "now"] };
  return null;
}

async function runPowerCommand(command: { command: string; args: string[] } | null, action: string): Promise<void> {
  if (command === null) {
    throw new Error(`No supported ${action} command was found (systemctl or shutdown)`);
  }
  await runCommand(command.command, command.args, { timeoutMs: 20_000 });
}

export async function performShutdown(): Promise<void> {
  await runPowerCommand(resolvePowerCommand(), "shutdown");
}

export async function performRestart(): Promise<void> {
  await runPowerCommand(resolveRestartCommand(), "restart");
}

export function powerDiagnostics(): Promise<DiagnosticCheck[]> {
  const shutdown = resolvePowerCommand();
  const restart = resolveRestartCommand();
  const checks: DiagnosticCheck[] = [
    shutdown === null || restart === null
      ? {
          name: "Power actions",
          status: "fail",
          detail: "neither systemctl nor shutdown was found on this system",
        }
      : {
          name: "Power actions",
          status: "ok",
          detail: `shutdown through ${shutdown.command} ${shutdown.args.join(" ")}, restart through ${restart.command} ${restart.args.join(" ")}`,
        },
    {
      name: "Power action permissions",
      status: "warn",
      detail:
        "systemctl poweroff and reboot are refused for unprivileged users unless polkit grants the action or Thermora runs under a service manager",
    },
  ];
  return Promise.resolve(checks);
}
