import path from "node:path";
import type { DiagnosticCheck, StartupContext, StartupInstallation, StartupRemoval } from "../../types.js";
import { commandFailure, tryCommand } from "../../utils/exec.js";

export const WINDOWS_TASK_NAME = "Thermora";
const SCHEDULER_RELATIVE_PATH = path.join("System32", "schtasks.exe");

export function startupTargetLabel(): string {
  return `Task Scheduler task ${WINDOWS_TASK_NAME}`;
}

export function schedulerExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? "";
  if (systemRoot.trim().length > 0) return path.join(systemRoot, SCHEDULER_RELATIVE_PATH);
  return "schtasks.exe";
}

function quoteArgument(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function buildTaskCommand(context: StartupContext): string {
  return [context.command, ...context.args].map(quoteArgument).join(" ");
}

export async function installStartup(context: StartupContext): Promise<StartupInstallation> {
  const scheduler = schedulerExecutable();
  const taskCommand = buildTaskCommand(context);
  const baseArgs = [
    "/Create",
    "/TN",
    WINDOWS_TASK_NAME,
    "/TR",
    taskCommand,
    "/SC",
    "ONLOGON",
    "/F",
  ];

  const elevated = await tryCommand(scheduler, [...baseArgs, "/RL", "HIGHEST"], { timeoutMs: 30_000 });
  if (elevated.ok) {
    return { serviceName: WINDOWS_TASK_NAME, target: startupTargetLabel(), started: true };
  }

  const limited = await tryCommand(scheduler, [...baseArgs, "/RL", "LIMITED"], { timeoutMs: 30_000 });
  if (limited.ok) {
    return { serviceName: WINDOWS_TASK_NAME, target: startupTargetLabel(), started: true };
  }

  throw commandFailure(scheduler, [...baseArgs, "/RL", "LIMITED"], limited);
}

export async function uninstallStartup(): Promise<StartupRemoval> {
  const scheduler = schedulerExecutable();
  const args = ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"];
  const result = await tryCommand(scheduler, args, { timeoutMs: 30_000 });
  return {
    serviceName: WINDOWS_TASK_NAME,
    target: startupTargetLabel(),
    removed: result.ok,
  };
}

export async function startupDiagnostics(): Promise<DiagnosticCheck[]> {
  const scheduler = schedulerExecutable();
  const query = await tryCommand(scheduler, ["/Query", "/TN", WINDOWS_TASK_NAME], { timeoutMs: 15_000 });
  const checks: DiagnosticCheck[] = [
    query.missing
      ? {
          name: "Startup integration (Task Scheduler)",
          status: "fail",
          detail: `${scheduler} was not found`,
        }
      : {
          name: "Startup integration (Task Scheduler)",
          status: "ok",
          detail: `schtasks available at ${scheduler}`,
        },
    query.ok
      ? { name: "Scheduled task", status: "ok", detail: `${WINDOWS_TASK_NAME} is registered` }
      : {
          name: "Scheduled task",
          status: "warn",
          detail: `not registered; run "thermora setup" to create the ${WINDOWS_TASK_NAME} logon task`,
        },
  ];
  return checks;
}
