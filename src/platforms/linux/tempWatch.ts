import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import si from "systeminformation";
import type { DiagnosticCheck, TemperatureReading } from "../../types.js";
import { formatTemperature } from "../../utils/format.js";
import { buildTemperatureReading, maxTemperature, normalizeTemperature, safeSensor } from "../../utils/sensors.js";
import {
  LINUX_PROVIDER,
  mergeSensorSources,
  readExternalTemperatures,
  sensorProviderDiagnostics,
} from "../externalProvider.js";

const THERMAL_ZONE_DIRECTORY = "/sys/class/thermal";
const CPU_ZONE_PATTERN = /x86_pkg_temp|acpitz|cpu|coretemp|k10temp|zenpower|soc_thermal/i;

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function readThermalZones(): Promise<number[]> {
  let entries: string[];
  try {
    entries = await readdir(THERMAL_ZONE_DIRECTORY);
  } catch {
    return [];
  }

  const readings: number[] = [];
  for (const entry of entries.filter((name) => name.startsWith("thermal_zone"))) {
    const zoneDirectory = path.join(THERMAL_ZONE_DIRECTORY, entry);
    const zoneType = await readTextFile(path.join(zoneDirectory, "type"));
    if (zoneType === null || !CPU_ZONE_PATTERN.test(zoneType.trim())) continue;
    const raw = await readTextFile(path.join(zoneDirectory, "temp"));
    if (raw === null) continue;
    const milliDegrees = Number.parseFloat(raw.trim());
    if (!Number.isFinite(milliDegrees)) continue;
    const temperature = normalizeTemperature(milliDegrees / 1000);
    if (temperature !== null) readings.push(temperature);
  }
  return readings;
}

export async function readTemperatures(): Promise<TemperatureReading> {
  const cpuTemperature = await safeSensor(() => si.cpuTemperature(), null);
  const graphics = await safeSensor(() => si.graphics(), null);
  const thermalZones = await readThermalZones();

  const zoneMax = maxTemperature(thermalZones);
  const systemInformationMain = normalizeTemperature(cpuTemperature?.main);
  const systemInformationMax = maxTemperature([cpuTemperature?.main, cpuTemperature?.max]);
  const fallback = systemInformationMax === null ? zoneMax : null;

  const internal = {
    cpu: {
      main: systemInformationMain ?? fallback,
      max: systemInformationMax ?? fallback,
      cores: cpuTemperature?.cores ?? [],
    },
    gpuDevices: (graphics?.controllers ?? []).map((controller) => ({
      name: controller.model,
      vendor: controller.vendor ?? null,
      temperature: controller.temperatureGpu ?? null,
    })),
  };

  const external = await readExternalTemperatures(LINUX_PROVIDER);
  const merged = mergeSensorSources(internal, external.ok ? { cpu: external.cpu, gpu: external.gpu } : { cpu: [], gpu: [] });

  return buildTemperatureReading({ cpu: merged.cpu, gpuDevices: merged.gpuDevices });
}

export async function temperatureDiagnostics(): Promise<DiagnosticCheck[]> {
  const reading = await readTemperatures();
  const thermalZones = await readThermalZones();
  const checks: DiagnosticCheck[] = [];
  const cpuHighest = reading.cpu.max ?? reading.cpu.main;

  if (cpuHighest === null) {
    checks.push({
      name: "CPU temperature",
      status: "warn",
      detail:
        "no CPU temperature was readable. Kernel modules such as coretemp, k10temp or zenpower are often required before sensors are exposed. An external provider can supply readings",
    });
  } else {
    checks.push({
      name: "CPU temperature",
      status: "ok",
      detail: `highest reported CPU temperature ${formatTemperature(cpuHighest)}`,
    });
  }

  checks.push(
    thermalZones.length > 0
      ? {
          name: "Kernel thermal zones",
          status: "ok",
          detail: `${thermalZones.length} readable thermal zone(s) under ${THERMAL_ZONE_DIRECTORY}`,
        }
      : {
          name: "Kernel thermal zones",
          status: "warn",
          detail: `no readable CPU thermal zone was found under ${THERMAL_ZONE_DIRECTORY}`,
        },
  );

  if (reading.gpu.max === null) {
    checks.push({
      name: "GPU temperature",
      status: "warn",
      detail:
        "no GPU temperature was reported. Vendor drivers must expose one to user space. An external provider can supply readings",
    });
  } else {
    checks.push({
      name: "GPU temperature",
      status: "ok",
      detail: `highest reported GPU temperature ${formatTemperature(reading.gpu.max)}`,
    });
  }

  checks.push(...(await sensorProviderDiagnostics(LINUX_PROVIDER)));
  return checks;
}
