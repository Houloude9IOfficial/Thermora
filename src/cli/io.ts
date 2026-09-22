export type CliIo = {
  write(message: string): void;
  writeError(message: string): void;
};

export const consoleIo: CliIo = {
  write: (message: string): void => {
    process.stdout.write(`${message}\n`);
  },
  writeError: (message: string): void => {
    process.stderr.write(`${message}\n`);
  },
};

export type CapturedIo = CliIo & {
  readonly output: string[];
  readonly errors: string[];
};

export function createCapturedIo(): CapturedIo {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    output,
    errors,
    write: (message: string): void => {
      output.push(message);
    },
    writeError: (message: string): void => {
      errors.push(message);
    },
  };
}

export function writeLines(io: CliIo, lines: readonly string[]): void {
  for (const line of lines) io.write(line);
}
