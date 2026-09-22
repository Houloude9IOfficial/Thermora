import type { TemperatureReading } from "../types.js";

export const MIN_VALID_TEMPERATURE = 0;
export const MAX_VALID_TEMPERATURE = 150;

export function normalizeTemperature(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= MIN_VALID_TEMPERATURE || value > MAX_VALID_TEMPERATURE) return null;
  return value;
}

export function normalizeTemperatureList(values: readonly unknown[]): number[] {
  const normalized: number[] = [];
  for (const value of values) {
    const temperature = normalizeTemperature(value);
    if (temperature !== null) normalized.push(temperature);
  }
  return normalized;
}

export function maxTemperature(values: readonly unknown[]): number | null {
  let maximum: number | null = null;
  for (const value of values) {
    const temperature = normalizeTemperature(value);
    if (temperature === null) continue;
    if (maximum === null || temperature > maximum) maximum = temperature;
  }
  return maximum;
}

export type RawCpuTemperatureInput = {
  main?: unknown;
  max?: unknown;
  cores?: readonly unknown[];
};

export type RawGpuDeviceInput = {
  name?: string | null;
  vendor?: string | null;
  temperature?: unknown;
};

export type RawReadingInput = {
  cpu: RawCpuTemperatureInput;
  gpuDevices: readonly RawGpuDeviceInput[];
};

function normalizeOptionalName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildTemperatureReading(input: RawReadingInput): TemperatureReading {
  const cores = normalizeTemperatureList(input.cpu.cores ?? []);
  const main = normalizeTemperature(input.cpu.main);
  const cpuMax = maxTemperature([main, input.cpu.max, ...cores]);

  const devices = input.gpuDevices.map((device) => ({
    name: normalizeOptionalName(device.name) ?? "Unknown GPU",
    vendor: normalizeOptionalName(device.vendor),
    temperature: normalizeTemperature(device.temperature),
  }));

  const gpuMax = maxTemperature(devices.map((device) => device.temperature));
  const globalMax = maxTemperature([main, cpuMax, ...cores, gpuMax]);

  return {
    cpu: { main, max: cpuMax, cores },
    gpu: { max: gpuMax, devices },
    global: { max: globalMax },
  };
}

export function hasTemperatureData(reading: TemperatureReading): boolean {
  return (
    reading.cpu.main !== null ||
    reading.cpu.max !== null ||
    reading.cpu.cores.length > 0 ||
    reading.gpu.max !== null ||
    reading.gpu.devices.some((device) => device.temperature !== null)
  );
}

export async function safeSensor<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch {
    return fallback;
  }
}
