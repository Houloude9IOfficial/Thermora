export type CooldownRecord<T> = {
  at: number;
  value: T;
};

export class FailureCooldown<T = string> {
  private readonly records = new Map<string, CooldownRecord<T>>();
  private readonly durationMs: number;
  private readonly clock: () => number;

  constructor(durationMs: number, clock: () => number = (): number => Date.now()) {
    this.durationMs = durationMs;
    this.clock = clock;
  }

  active(key: string): boolean {
    const record = this.records.get(key);
    if (record === undefined) return false;
    return this.clock() - record.at < this.durationMs;
  }

  get(key: string): T | null {
    const record = this.records.get(key);
    return record === undefined ? null : record.value;
  }

  record(key: string, value: T): void {
    this.records.set(key, { at: this.clock(), value });
  }

  clear(key: string): void {
    this.records.delete(key);
  }

  reset(): void {
    this.records.clear();
  }
}
