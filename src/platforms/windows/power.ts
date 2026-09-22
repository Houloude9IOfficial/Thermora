import path from "node:path";
import type { DiagnosticCheck } from "../../types.js";
import { commandFailure, pathExists, tryCommand } from "../../utils/exec.js";

export function shutdownExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? "";
  if (systemRoot.trim().length > 0) return path.join(systemRoot, "System32", "shutdown.exe");
  return "shutdown.exe";
}

async function runShutdownCommand(args: readonly string[]): Promise<void> {
  const executable = shutdownExecutable();
  const result = await tryCommand(executable, args, { timeoutMs: 20_000 });
  if (!result.ok) throw commandFailure(executable, args, result);
}

export async function performShutdown(): Promise<void> {
  await runShutdownCommand(["/s", "/t", "0"]);
}

export async function performRestart(): Promise<void> {
  await runShutdownCommand(["/r", "/t", "0"]);
}

export function powerDiagnostics(): Promise<DiagnosticCheck[]> {
  const executable = shutdownExecutable();
  const checks: DiagnosticCheck[] = [
    pathExists(executable)
      ? { name: "Power actions", status: "ok", detail: `shutdown.exe available at ${executable}` }
      : {
          name: "Power actions",
          status: "fail",
          detail: `${executable} was not found, so shutdown and restart cannot be requested`,
        },
    {
      name: "Power action permissions",
      status: "warn",
      detail:
        "shutdown and restart can be refused when the account lacks the shutdown privilege, for example on hardened servers",
    },
  ];
  return Promise.resolve(checks);
}
