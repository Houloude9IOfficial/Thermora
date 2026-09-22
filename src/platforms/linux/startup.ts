import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiagnosticCheck, StartupContext, StartupInstallation, StartupRemoval } from "../../types.js";
import { commandFailure, findExecutable, tryCommand } from "../../utils/exec.js";

export const LINUX_SERVICE_NAME = "thermora.service";
const SYSTEMCTL_CANDIDATES = ["/usr/bin/systemctl", "/bin/systemctl"];

export function startupTargetPath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", LINUX_SERVICE_NAME);
}

function systemdEscape(value: string): string {
  return value.replace(/([\\"])/g, "\\$1");
}

export function buildServiceUnit(context: StartupContext): string {
  const execStart = [context.command, ...context.args].map(systemdEscape).join(" ");
  return [
    "[Unit]",
    "Description=Thermora thermal protection daemon",
    "Documentation=https://github.com/thermora/thermora",
    "After=default.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${execStart}`,
    `WorkingDirectory=${systemdEscape(context.projectRoot)}`,
    "Restart=on-failure",
    "RestartSec=5",
    "KillSignal=SIGTERM",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

function systemctl(): string | null {
  return findExecutable(SYSTEMCTL_CANDIDATES);
}

export async function installStartup(context: StartupContext): Promise<StartupInstallation> {
  const binary = systemctl();
  if (binary === null) {
    throw new Error("systemctl was not found; a systemd user service cannot be installed on this system");
  }
  const target = startupTargetPath();
  mkdirSync(path.dirname(target), { recursive: true });
  mkdirSync(context.logDirectory, { recursive: true });
  writeFileSync(target, buildServiceUnit(context), "utf8");

  const reload = await tryCommand(binary, ["--user", "daemon-reload"]);
  if (!reload.ok) throw commandFailure(binary, ["--user", "daemon-reload"], reload);

  const enable = await tryCommand(binary, ["--user", "enable", "--now", LINUX_SERVICE_NAME]);
  if (!enable.ok) throw commandFailure(binary, ["--user", "enable", "--now", LINUX_SERVICE_NAME], enable);

  return { serviceName: LINUX_SERVICE_NAME, target, started: true };
}

export async function uninstallStartup(): Promise<StartupRemoval> {
  const binary = systemctl();
  const target = startupTargetPath();
  const installed = existsSync(target);

  if (binary !== null) {
    await tryCommand(binary, ["--user", "disable", "--now", LINUX_SERVICE_NAME]);
  }
  if (installed) rmSync(target, { force: true });
  if (binary !== null) {
    await tryCommand(binary, ["--user", "daemon-reload"]);
  }

  return { serviceName: LINUX_SERVICE_NAME, target, removed: installed };
}

export async function startupDiagnostics(): Promise<DiagnosticCheck[]> {
  const binary = systemctl();
  const target = startupTargetPath();
  const checks: DiagnosticCheck[] = [
    binary === null
      ? { name: "Startup integration (systemd)", status: "fail", detail: "systemctl was not found" }
      : { name: "Startup integration (systemd)", status: "ok", detail: `systemctl available at ${binary}` },
    existsSync(target)
      ? { name: "User service", status: "ok", detail: `installed at ${target}` }
      : {
          name: "User service",
          status: "warn",
          detail: `not installed; run "thermora setup" to create ${target}`,
        },
  ];

  if (binary !== null) {
    const linger = await tryCommand(binary, ["--user", "show-environment"]);
    if (!linger.ok) {
      checks.push({
        name: "User service session",
        status: "warn",
        detail:
          "the systemd user manager is not reachable from this session; a user service only runs while the user has an active session unless lingering is enabled",
      });
    }
  }

  return checks;
}
