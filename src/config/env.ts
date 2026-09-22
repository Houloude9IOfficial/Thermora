import { existsSync } from "node:fs";

export function loadEnvironmentFile(filePath: string): boolean {
  if (filePath.length === 0 || !existsSync(filePath)) return false;
  try {
    process.loadEnvFile(filePath);
    return true;
  } catch {
    return false;
  }
}
