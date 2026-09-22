import path from "node:path";
import si from "systeminformation";
import type { DiagnosticCheck, TemperatureReading } from "../../types.js";
import { FailureCooldown } from "../../utils/cooldown.js";
import { tryCommand } from "../../utils/exec.js";
import { formatTemperature } from "../../utils/format.js";
import { buildTemperatureReading, maxTemperature, safeSensor } from "../../utils/sensors.js";
import {
  WINDOWS_PROVIDER,
  mergeSensorSources,
  readExternalTemperatures,
  sensorProviderDiagnostics,
} from "../externalProvider.js";

const ACPI_QUERY =
  "Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Select-Object -ExpandProperty CurrentTemperature";
const ACPI_TIMEOUT_MS = 15_000;
const ACPI_FAILURE_COOLDOWN_MS = 300_000;
const KELVIN_OFFSET = 273.15;

export function resolvePowerShell(): string | null {
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? "";
  if (systemRoot.trim().length === 0) return null;
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export function parseAcpiTemperatures(output: string): number[] {
  const readings: number[] = [];
  for (const token of output.split(/\s+/)) {
    if (token.trim().length === 0) continue;
    const tenthsOfKelvin = Number(token.trim());
    if (!Number.isFinite(tenthsOfKelvin)) continue;
    const celsius = tenthsOfKelvin / 10 - KELVIN_OFFSET;
    if (celsius <= 0 || celsius > 150) continue;
    readings.push(Math.round(celsius * 100) / 100);
  }
  return readings;
}

const acpiCooldown = new FailureCooldown<string>(ACPI_FAILURE_COOLDOWN_MS);

export function resetAcpiState(): void {
  acpiCooldown.reset();
}

async function readAcpiThermalZones(): Promise<number[]> {
  const powershell = resolvePowerShell();
  if (powershell === null) return [];
  if (acpiCooldown.active(ACPI_QUERY)) return [];

  const result = await tryCommand(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", ACPI_QUERY],
    { timeoutMs: ACPI_TIMEOUT_MS },
  );

  if (!result.ok) {
    acpiCooldown.record(ACPI_QUERY, result.error ?? "ACPI thermal zone query failed");
    return [];
  }

  const readings = parseAcpiTemperatures(result.stdout);
  if (readings.length === 0) {
    acpiCooldown.record(ACPI_QUERY, "no ACPI thermal zone reported a temperature");
    return [];
  }

  acpiCooldown.clear(ACPI_QUERY);
  return readings;
}

export async function readTemperatures(): Promise<TemperatureReading> {
  const cpuTemperature = await safeSensor(() => si.cpuTemperature(), null);
  const graphics = await safeSensor(() => si.graphics(), null);

  const systemInformationMain = cpuTemperature?.main ?? null;
  const systemInformationMax = maxTemperature([systemInformationMain, cpuTemperature?.max]);
  const acpiReadings = systemInformationMax === null ? await readAcpiThermalZones() : [];
  const acpiMax = maxTemperature(acpiReadings);
  const fallbackMax = systemInformationMax ?? acpiMax;

  const internal = {
    cpu: {
      main: systemInformationMain ?? fallbackMax,
      max: systemInformationMax ?? fallbackMax,
      cores: cpuTemperature?.cores ?? [],
    },
    gpuDevices: (graphics?.controllers ?? []).map((controller) => ({
      name: controller.model,
      vendor: controller.vendor ?? null,
      temperature: controller.temperatureGpu ?? null,
    })),
  };

  const external = await readExternalTemperatures(WINDOWS_PROVIDER);
  const merged = mergeSensorSources(internal, external.ok ? { cpu: external.cpu, gpu: external.gpu } : { cpu: [], gpu: [] });

  return buildTemperatureReading({ cpu: merged.cpu, gpuDevices: merged.gpuDevices });
}

export async function temperatureDiagnostics(): Promise<DiagnosticCheck[]> {
  const reading = await readTemperatures();
  const checks: DiagnosticCheck[] = [];
  const cpuHighest = reading.cpu.max ?? reading.cpu.main;

  if (cpuHighest === null) {
    checks.push({
      name: "CPU temperature",
      status: "warn",
      detail:
        "no CPU temperature was readable. Windows exposes none unless the firmware publishes ACPI thermal zones and the account can read root\\wmi, or a monitoring driver such as OpenHardwareMonitor is running. An external provider can supply readings",
    });
  } else {
    checks.push({
      name: "CPU temperature",
      status: "ok",
      detail: `highest reported CPU temperature ${formatTemperature(cpuHighest)}`,
    });
  }

  const powershell = resolvePowerShell();
  checks.push(
    powershell === null
      ? { name: "ACPI thermal zones", status: "warn", detail: "PowerShell was not found on this system" }
      : acpiCooldown.active(ACPI_QUERY)
        ? {
            name: "ACPI thermal zones",
            status: "warn",
            detail: `not readable: ${acpiCooldown.get(ACPI_QUERY) ?? "unknown reason"}. Reading root\\wmi usually requires an elevated account`,
          }
        : {
            name: "ACPI thermal zones",
            status: "ok",
            detail: `queried through ${powershell}`,
          },
  );

  if (reading.gpu.max === null) {
    checks.push({
      name: "GPU temperature",
      status: "warn",
      detail:
        "no GPU temperature was readable. Vendor driver support is required, for example an NVIDIA driver exposing nvidia-smi. An external provider can supply readings",
    });
  } else {
    checks.push({
      name: "GPU temperature",
      status: "ok",
      detail: `highest reported GPU temperature ${formatTemperature(reading.gpu.max)}`,
    });
  }

  checks.push(...(await sensorProviderDiagnostics(WINDOWS_PROVIDER)));
  return checks;
}
