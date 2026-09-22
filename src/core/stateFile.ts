import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DaemonStatusSnapshot } from "../types.js";

export function writeStateSnapshot(stateFile: string, snapshot: DaemonStatusSnapshot): void {
  mkdirSync(path.dirname(stateFile), { recursive: true });
  const temporary = `${stateFile}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  renameSync(temporary, stateFile);
}

export function readStateSnapshot(stateFile: string): DaemonStatusSnapshot | null {
  try {
    const raw = readFileSync(stateFile, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Partial<DaemonStatusSnapshot>;
    if (typeof candidate.status !== "string") return null;
    if (typeof candidate.startedAt !== "string") return null;
    return parsed as DaemonStatusSnapshot;
  } catch {
    return null;
  }
}

export function probeStateFileWritable(stateFile: string): boolean {
  const probe = `${stateFile}.probe`;
  try {
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(probe, "ok\n", "utf8");
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function removeStateSnapshot(stateFile: string): void {
  try {
    rmSync(stateFile, { force: true });
  } catch {
    return;
  }
}
