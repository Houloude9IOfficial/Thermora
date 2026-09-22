import type { DiagnosticCheck } from "../../types.js";
import { findExecutable, runCommand } from "../../utils/exec.js";

const OSASCRIPT_CANDIDATES = ["/usr/bin/osascript", "/bin/osascript"];
const SHUTDOWN_SCRIPT = 'tell application "System Events" to shut down';
const RESTART_SCRIPT = 'tell application "System Events" to restart';

async function runSystemEventsScript(script: string): Promise<void> {
  const osascript = findExecutable(OSASCRIPT_CANDIDATES);
  if (osascript === null) {
    throw new Error("osascript was not found; macOS power actions are unavailable on this system");
  }
  await runCommand(osascript, ["-e", script], { timeoutMs: 20_000 });
}

export async function performShutdown(): Promise<void> {
  await runSystemEventsScript(SHUTDOWN_SCRIPT);
}

export async function performRestart(): Promise<void> {
  await runSystemEventsScript(RESTART_SCRIPT);
}

export function powerDiagnostics(): Promise<DiagnosticCheck[]> {
  const osascript = findExecutable(OSASCRIPT_CANDIDATES);
  const checks: DiagnosticCheck[] = [
    osascript === null
      ? {
          name: "Power actions",
          status: "fail",
          detail: "osascript was not found, so shutdown and restart cannot be requested",
        }
      : {
          name: "Power actions",
          status: "ok",
          detail: `osascript available at ${osascript}; shutdown and restart are requested through System Events`,
        },
    {
      name: "Power action permissions",
      status: "warn",
      detail:
        "macOS may deny Automation permission the first time Thermora requests a shutdown or restart",
    },
  ];
  return Promise.resolve(checks);
}
