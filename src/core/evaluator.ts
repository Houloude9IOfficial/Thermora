import type {
  EvaluationOutcome,
  TemperatureReading,
  ThermalPolicy,
  ThresholdKind,
  ThresholdStatus,
  ViolationCounters,
} from "../types.js";
import { formatTemperature } from "../utils/format.js";

export const THRESHOLD_ORDER: readonly ThresholdKind[] = ["cpu", "gpu", "global"];

export const THRESHOLD_LABELS: Record<ThresholdKind, string> = {
  cpu: "CPU",
  gpu: "GPU",
  global: "Global",
};

export function createViolationCounters(): ViolationCounters {
  return { cpu: 0, gpu: 0, global: 0 };
}

export function thresholdFor(kind: ThresholdKind, policy: ThermalPolicy): number {
  switch (kind) {
    case "cpu":
      return policy.limits.cpuMax;
    case "gpu":
      return policy.limits.gpuMax;
    case "global":
      return policy.limits.globalMax;
  }
}

export function thresholdTemperature(reading: TemperatureReading, kind: ThresholdKind): number | null {
  switch (kind) {
    case "cpu":
      return reading.cpu.max ?? reading.cpu.main;
    case "gpu":
      return reading.gpu.max;
    case "global":
      return reading.global.max;
  }
}

export function formatTriggeredReason(statuses: readonly ThresholdStatus[]): string | null {
  const triggered = statuses.filter((status) => status.triggered);
  if (triggered.length === 0) return null;
  return triggered
    .map(
      (status) =>
        `${status.label} reached ${formatTemperature(status.temperature)} (limit ${status.threshold} C)`,
    )
    .join("; ");
}

export function evaluateReading(
  reading: TemperatureReading,
  policy: ThermalPolicy,
  counters: ViolationCounters,
): EvaluationOutcome {
  const nextCounters = createViolationCounters();
  const statuses: ThresholdStatus[] = [];

  for (const kind of THRESHOLD_ORDER) {
    const threshold = thresholdFor(kind, policy);
    const temperature = thresholdTemperature(reading, kind);
    const exceeded = temperature !== null && temperature > threshold;
    const previous = counters[kind] ?? 0;
    const count = exceeded ? previous + 1 : 0;
    nextCounters[kind] = count;
    statuses.push({
      kind,
      label: THRESHOLD_LABELS[kind],
      temperature,
      threshold,
      count,
      required: policy.limits.requiredSamples,
      exceeded,
      triggered: exceeded && count >= policy.limits.requiredSamples,
    });
  }

  const reason = formatTriggeredReason(statuses);
  if (reason === null) {
    return { counters: nextCounters, statuses, action: null, reason: null };
  }

  return { counters: nextCounters, statuses, action: policy.action, reason };
}
