import type { LogLevel, Logger } from "../types.js";

export type LoggerOptions = {
  level?: LogLevel;
  write?: (message: string) => void;
  writeError?: (message: string) => void;
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const write = options.write ?? ((message: string): void => void process.stdout.write(`${message}\n`));
  const writeError = options.writeError ?? ((message: string): void => void process.stderr.write(`${message}\n`));
  const suppressed = new Set<string>();

  const emit = (severity: LogLevel, message: string): void => {
    if (LEVEL_PRIORITY[severity] < LEVEL_PRIORITY[level]) return;
    const line = `[${severity.toUpperCase()}] ${message}`;
    if (severity === "warn" || severity === "error") {
      writeError(line);
      return;
    }
    write(line);
  };

  return {
    debug: (message: string): void => emit("debug", message),
    info: (message: string): void => emit("info", message),
    warn: (message: string): void => emit("warn", message),
    error: (message: string): void => emit("error", message),
    warnOnce: (key: string, message: string): void => {
      if (suppressed.has(key)) return;
      suppressed.add(key);
      emit("warn", message);
    },
    clearOnce: (key: string): void => {
      suppressed.delete(key);
    },
  };
}

export const silentLogger: Logger = {
  debug: (): void => undefined,
  info: (): void => undefined,
  warn: (): void => undefined,
  error: (): void => undefined,
  warnOnce: (): void => undefined,
  clearOnce: (): void => undefined,
};

export type RecordingLogger = Logger & {
  readonly lines: string[];
  clear(): void;
};

export function createRecordingLogger(level: LogLevel = "debug"): RecordingLogger {
  const lines: string[] = [];
  const logger = createLogger({
    level,
    write: (message: string): void => void lines.push(message),
    writeError: (message: string): void => void lines.push(message),
  });
  return {
    ...logger,
    lines,
    clear: (): void => {
      lines.length = 0;
    },
  };
}
