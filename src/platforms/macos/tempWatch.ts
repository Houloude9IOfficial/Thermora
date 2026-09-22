import si from "systeminformation";
import type { DiagnosticCheck, TemperatureReading } from "../../types.js";
import { formatTemperature } from "../../utils/format.js";
import { buildTemperatureReading, safeSensor } from "../../utils/sensors.js";

export async function readTemperatures(): Promise<TemperatureReading> {
  const cpuTemperature = await safeSensor(() => si.cpuTemperature(), null);
  const graphics = await safeSensor(() => si.graphics(), null);

  return buildTemperatureReading({
    cpu: {
      main: cpuTemperature?.main,
      max: cpuTemperature?.max,
      cores: cpuTemperature?.cores ?? [],
    },
    gpuDevices: (graphics?.controllers ?? []).map((controller) => ({
      name: controller.model,
      vendor: controller.vendor,
      temperature: controller.temperatureGpu,
    })),
  });
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
        "no CPU temperature sensor was reported. Apple Silicon Macs frequently expose none to user space, and Intel Macs may need elevated privileges for the SMC sensors",
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
      detail:
        "no GPU temperature sensor was reported. Integrated Apple GPUs and many discrete drivers do not expose one to user space",
    });
  } else {
    checks.push({
      name: "GPU temperature",
      status: "ok",
      detail: `highest reported GPU temperature ${formatTemperature(reading.gpu.max)}`,
    });
  }

  return checks;
}
