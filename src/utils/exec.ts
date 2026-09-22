import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";

export type CommandExecution = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
  permissionDenied: boolean;
  missing: boolean;
};

export type CommandOptions = {
  timeoutMs?: number;
};

export class CommandError extends Error {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(
    message: string,
    command: string,
    args: readonly string[],
    exitCode: number | null,
    stderr: string,
  ) {
    super(message);
    this.name = "CommandError";
    this.command = command;
    this.args = args;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

export class PermissionError extends CommandError {
  constructor(
    message: string,
    command: string,
    args: readonly string[],
    exitCode: number | null,
    stderr: string,
  ) {
    super(message, command, args, exitCode, stderr);
    this.name = "PermissionError";
  }
}

export function commandFailure(
  command: string,
  args: readonly string[],
  result: CommandExecution,
): CommandError {
  if (result.permissionDenied) {
    return new PermissionError(
      `${command} was denied permission. Thermora never elevates privileges on its own; run the command from an elevated shell (root or administrator) if this system requires it.`,
      command,
      args,
      result.code,
      result.stderr,
    );
  }
  if (result.missing) {
    return new CommandError(
      `${command} was not found on this system.`,
      command,
      args,
      result.code,
      result.stderr,
    );
  }
  const detail = result.error ?? result.stderr.trim();
  return new CommandError(
    `${command} exited with code ${result.code ?? "unknown"}${detail.length > 0 ? `: ${detail}` : ""}`,
    command,
    args,
    result.code,
    result.stderr,
  );
}

export function tryCommand(
  command: string,
  args: readonly string[] = [],
  options: CommandOptions = {},
): Promise<CommandExecution> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  return new Promise<CommandExecution>((resolve) => {
    execFile(
      command,
      [...args],
      {
        timeout: timeoutMs,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        shell: false,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const standardOut = typeof stdout === "string" ? stdout : "";
        const standardError = typeof stderr === "string" ? stderr : "";
        if (error === null || error === undefined) {
          resolve({
            ok: true,
            code: 0,
            stdout: standardOut,
            stderr: standardError,
            error: null,
            permissionDenied: false,
            missing: false,
          });
          return;
        }
        const rawCode = (error as NodeJS.ErrnoException).code;
        const textCode = typeof rawCode === "string" ? rawCode : null;
        const numericCode = typeof rawCode === "number" ? rawCode : null;
        const missing = textCode === "ENOENT";
        const permissionDenied = textCode === "EACCES" || textCode === "EPERM";
        const killed = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
        const detail = missing
          ? `${command} was not found`
          : killed
            ? `${command} timed out after ${timeoutMs} ms`
            : standardError.trim().length > 0
              ? standardError.trim()
              : error.message;
        resolve({
          ok: false,
          code: numericCode,
          stdout: standardOut,
          stderr: standardError,
          error: detail,
          permissionDenied,
          missing,
        });
      },
    );
  });
}

export async function runCommand(
  command: string,
  args: readonly string[] = [],
  options: CommandOptions = {},
): Promise<CommandExecution> {
  const result = await tryCommand(command, args, options);
  if (!result.ok) throw commandFailure(command, args, result);
  return result;
}

export function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function pathExists(filePath: string): boolean {
  try {
    accessSync(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function findExecutable(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}
