import si from "systeminformation";
import type { DiagnosticCheck, GpuTemperature, TemperatureReading } from "../../types.js";
import { formatTemperature } from "../../utils/format.js";
import { buildTemperatureReading, safeSensor } from "../../utils/sensors.js";
import { readExternalTemperatures, sensorProviderDiagnostics } from "./sensorProvider.js";

export type InternalTemperatureSources = {
  cpu: {
    main: number | null;
    max: number | null;
    cores: number[];
  };
  gpuDevices: {
    name: string;
    vendor: string | null;
    temperature: number | null;
  }[];
};

export type ExternalTemperatureSources = {
  cpu: readonly number[];
  gpu: readonly GpuTemperature[];
};

export function mergeTemperatureSources(
  internal: InternalTemperatureSources,
  external: ExternalTemperatureSources,
): InternalTemperatureSources {
  const cpuAvailable = internal.cpu.main !== null || internal.cpu.max !== null || internal.cpu.cores.length > 0;
  const gpuAvailable = internal.gpuDevices.some((device) => device.temperature !== null);

  const cpu =
    cpuAvailable || external.cpu.length === 0
      ? internal.cpu
      : {
          main: external.cpu[0] ?? null,
          max: null,
          cores: [...external.cpu],
        };

  const gpuDevices =
    gpuAvailable || external.gpu.length === 0
      ? internal.gpuDevices
      : external.gpu.map((device) => ({
          name: device.name,
          vendor: device.vendor,
          temperature: device.temperature,
        }));

  return { cpu, gpuDevices };
}

export async function readTemperatures(): Promise<TemperatureReading> {
  const cpuTemperature = await safeSensor(() => si.cpuTemperature(), null);
  const graphics = await safeSensor(() => si.graphics(), null);

  const internal: InternalTemperatureSources = {
    cpu: {
      main: cpuTemperature?.main ?? null,
      max: cpuTemperature?.max ?? null,
      cores: cpuTemperature?.cores ?? [],
    },
    gpuDevices: (graphics?.controllers ?? []).map((controller) => ({
      name: controller.model,
      vendor: controller.vendor ?? null,
      temperature: controller.temperatureGpu ?? null,
    })),
  };

  const external = await readExternalTemperatures();
  const merged = mergeTemperatureSources(
    internal,
    external.ok ? { cpu: external.cpu, gpu: external.gpu } : { cpu: [], gpu: [] },
  );

  return buildTemperatureReading({ cpu: merged.cpu, gpuDevices: merged.gpuDevices });
}

function platformSensorHint(): string {
  if (process.arch === "arm64") {
    return "Apple Silicon exposes no CPU or GPU temperature to user space, and current macOS has removed the powermetrics SMC sampler, so no first-party tool can read one on this machine";
  }
  return "Intel Macs read these through the SMC, which may require elevated privileges";
}

export async function temperatureDiagnostics(): Promise<DiagnosticCheck[]> {
  const reading = await readTemperatures();
  const checks: DiagnosticCheck[] = [];
  const cpuHighest = reading.cpu.max ?? reading.cpu.main;

  if (cpuHighest === null) {
    checks.push({
      name: "CPU temperature",
      status: "warn",
      detail: `no CPU temperature sensor was reported. ${platformSensorHint()}`,
    });
  } else {
    checks.push({
      name: "CPU temperature",
      status: "ok",
      detail: `highest reported CPU temperature ${formatTemperature(cpuHighest)}`,
    });
  }

  if (reading.gpu.max === null) {
    checks.push({
      name: "GPU temperature",
      status: "warn",
      detail: `no GPU temperature sensor was reported. ${platformSensorHint()}`,
    });
  } else {
    checks.push({
      name: "GPU temperature",
      status: "ok",
      detail: `highest reported GPU temperature ${formatTemperature(reading.gpu.max)}`,
    });
  }

  checks.push(...(await sensorProviderDiagnostics()));
  return checks;
}
