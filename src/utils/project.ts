import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PackageMetadata = {
  name: string;
  version: string;
  description: string;
};

export function findProjectRoot(startDirectory?: string): string {
  const start = startDirectory ?? path.dirname(fileURLToPath(import.meta.url));
  let current = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(current, "package.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(start);
    current = parent;
  }
}

export function readPackageMetadata(projectRoot: string): PackageMetadata {
  try {
    const raw = readFileSync(path.join(projectRoot, "package.json"), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      return {
        name: typeof record.name === "string" ? record.name : "thermora",
        version: typeof record.version === "string" ? record.version : "0.0.0",
        description: typeof record.description === "string" ? record.description : "",
      };
    }
  } catch {
    return { name: "thermora", version: "0.0.0", description: "" };
  }
  return { name: "thermora", version: "0.0.0", description: "" };
}

export function compiledEntryPoint(projectRoot: string): string {
  return path.join(projectRoot, "dist", "index.js");
}

export function environmentFilePath(projectRoot: string): string {
  return path.join(projectRoot, ".env");
}

function supportsEnvFileIfExists(): boolean {
  const [major = "0", minor = "0"] = process.versions.node.split(".");
  const majorNumber = Number.parseInt(major, 10);
  const minorNumber = Number.parseInt(minor, 10);
  if (majorNumber > 22) return true;
  return majorNumber === 22 && minorNumber >= 9;
}

export function buildDaemonInvocation(projectRoot: string): { command: string; args: string[] } {
  const args: string[] = [];
  const envFile = environmentFilePath(projectRoot);
  if (supportsEnvFileIfExists()) args.push(`--env-file-if-exists=${envFile}`);
  args.push(compiledEntryPoint(projectRoot), "start");
  return { command: process.execPath, args };
}

export function resolveLogDirectory(): string {
  let home = "";
  try {
    home = os.homedir();
  } catch {
    home = "";
  }
  const base = home.length > 0 ? home : os.tmpdir();
  return path.join(base, ".thermora", "logs");
}

export function resolveNpmCommand(platformId: string): string {
  return platformId === "windows" ? "npm.cmd" : "npm";
}
