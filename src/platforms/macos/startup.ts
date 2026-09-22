import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiagnosticCheck, StartupContext, StartupInstallation, StartupRemoval } from "../../types.js";
import { commandFailure, findExecutable, pathExists, tryCommand } from "../../utils/exec.js";

export const MACOS_SERVICE_NAME = "com.thermora.daemon";
const LAUNCHCTL_CANDIDATES = ["/bin/launchctl", "/usr/bin/launchctl"];

export function startupTargetPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${MACOS_SERVICE_NAME}.plist`);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildLaunchAgent(context: StartupContext): string {
  const programArguments = [context.command, ...context.args]
    .map((argument) => `    <string>${escapeXml(argument)}</string>`)
    .join("\n");
  const standardOut = path.join(context.logDirectory, "thermora.log");
  const standardError = path.join(context.logDirectory, "thermora.error.log");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${MACOS_SERVICE_NAME}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    programArguments,
    "  </array>",
    "  <key>WorkingDirectory</key>",
    `  <string>${escapeXml(context.projectRoot)}</string>`,
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "  <key>StandardOutPath</key>",
    `  <string>${escapeXml(standardOut)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${escapeXml(standardError)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

export async function installStartup(context: StartupContext): Promise<StartupInstallation> {
  const launchctl = findExecutable(LAUNCHCTL_CANDIDATES);
  if (launchctl === null) {
    throw new Error("launchctl was not found; a launch agent cannot be installed on this system");
  }
  const target = startupTargetPath();
  mkdirSync(path.dirname(target), { recursive: true });
  mkdirSync(context.logDirectory, { recursive: true });
  writeFileSync(target, buildLaunchAgent(context), "utf8");

  await tryCommand(launchctl, ["unload", "-w", target]);
  const loaded = await tryCommand(launchctl, ["load", "-w", target]);
  if (!loaded.ok) throw commandFailure(launchctl, ["load", "-w", target], loaded);

  return { serviceName: MACOS_SERVICE_NAME, target, started: true };
}

export async function uninstallStartup(): Promise<StartupRemoval> {
  const target = startupTargetPath();
  const launchctl = findExecutable(LAUNCHCTL_CANDIDATES);
  const installed = pathExists(target);
  if (launchctl !== null) await tryCommand(launchctl, ["unload", "-w", target]);
  if (installed) rmSync(target, { force: true });
  return { serviceName: MACOS_SERVICE_NAME, target, removed: installed };
}

export function startupDiagnostics(): Promise<DiagnosticCheck[]> {
  const launchctl = findExecutable(LAUNCHCTL_CANDIDATES);
  const target = startupTargetPath();
  const checks: DiagnosticCheck[] = [
    launchctl === null
      ? { name: "Startup integration (launchd)", status: "fail", detail: "launchctl was not found" }
      : { name: "Startup integration (launchd)", status: "ok", detail: `launchctl available at ${launchctl}` },
    pathExists(target)
      ? { name: "Launch agent", status: "ok", detail: `installed at ${target}` }
      : {
          name: "Launch agent",
          status: "warn",
          detail: `not installed; run "thermora setup" to create ${target}`,
        },
  ];
  return Promise.resolve(checks);
}
