import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export class LockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockError";
  }
}

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    return code === "EPERM";
  }
}

export function readLockOwner(filePath: string): number | null {
  try {
    const raw = readFileSync(filePath, "utf8").trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

export class DaemonLock {
  private readonly filePath: string;
  private held = false;

  private constructor(filePath: string) {
    this.filePath = filePath;
  }

  static acquire(filePath: string): DaemonLock {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const owner = readLockOwner(filePath);
    if (owner !== null && owner !== process.pid && isProcessAlive(owner)) {
      throw new LockError(
        `Another Thermora monitor is already running with pid ${owner}. Stop it before starting a new one (lock file ${filePath}).`,
      );
    }
    writeFileSync(filePath, `${process.pid}\n`, "utf8");
    const lock = new DaemonLock(filePath);
    lock.held = true;
    return lock;
  }

  release(): void {
    if (!this.held) return;
    this.held = false;
    const owner = readLockOwner(this.filePath);
    if (owner === null || owner === process.pid) {
      try {
        rmSync(this.filePath, { force: true });
      } catch {
        return;
      }
    }
  }
}
