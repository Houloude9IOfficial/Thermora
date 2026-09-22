import type { TemperatureReading } from "../types.js";

export const UNAVAILABLE = "n/a";

export function formatTemperature(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNAVAILABLE;
  return `${Math.round(value)} C`;
}

export function describeReading(reading: TemperatureReading): string {
  const cpu = reading.cpu.max ?? reading.cpu.main;
  return `CPU ${formatTemperature(cpu)}, GPU ${formatTemperature(reading.gpu.max)}, global ${formatTemperature(reading.global.max)}`;
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "unknown error";
}

export function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return isoTimestamp;
  return date.toISOString().replace("T", " ").replace("Z", " UTC");
}
