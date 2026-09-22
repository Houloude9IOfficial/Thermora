export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

function parseSwitchValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  return null;
}

export class Options {
  private readonly values: Map<string, string | true>;

  private constructor(values: Map<string, string | true>) {
    this.values = values;
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  raw(name: string): string | true | undefined {
    return this.values.get(name);
  }

  value(name: string): string | null {
    const raw = this.values.get(name);
    if (raw === undefined) return null;
    if (raw === true) throw new CliUsageError(`--${name} requires a value`);
    return raw;
  }

  boolean(name: string): boolean | null {
    const raw = this.values.get(name);
    if (raw === undefined) return null;
    if (raw === true) return true;
    const parsed = parseSwitchValue(raw);
    if (parsed === null) throw new CliUsageError(`--${name} expects true or false`);
    return parsed;
  }

  names(): string[] {
    return [...this.values.keys()];
  }

  static parse(argv: readonly string[]): { options: Options; positionals: string[] } {
    const values = new Map<string, string | true>();
    const positionals: string[] = [];
    let literalOnly = false;

    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index] ?? "";

      if (literalOnly) {
        positionals.push(token);
        continue;
      }
      if (token === "--") {
        literalOnly = true;
        continue;
      }
      if (token.startsWith("--")) {
        const body = token.slice(2);
        const separator = body.indexOf("=");
        if (separator >= 0) {
          values.set(body.slice(0, separator), body.slice(separator + 1));
          continue;
        }
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith("-")) {
          values.set(body, next);
          index += 1;
          continue;
        }
        values.set(body, true);
        continue;
      }
      if (token.startsWith("-") && token.length > 1) {
        const short = token.slice(1);
        if (short === "h") values.set("help", true);
        else if (short === "v") values.set("version", true);
        else values.set(short, true);
        continue;
      }
      positionals.push(token);
    }

    return { options: new Options(values), positionals };
  }
}
