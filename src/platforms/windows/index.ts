import type { DiagnosticCheck, PlatformAdapter, TemperatureReading } from "../../types.js";
import { performRestart, performShutdown, powerDiagnostics } from "./power.js";
import { installStartup, startupDiagnostics, uninstallStartup } from "./startup.js";
import { readTemperatures, temperatureDiagnostics } from "./tempWatch.js";

export async function collectWindowsDiagnostics(): Promise<DiagnosticCheck[]> {
  const checks: DiagnosticCheck[] = [];
  checks.push(...(await temperatureDiagnostics()));
  checks.push(...(await powerDiagnostics()));
  checks.push(...(await startupDiagnostics()));
  return checks;
}

export function createWindowsAdapter(): PlatformAdapter {
  return {
    id: "windows",
    name: "Windows",
    capabilities: {
      cpuTemperature: true,
      gpuTemperature: true,
      restart: true,
      shutdown: true,
      startup: true,
    },
    getTemperatures: (): Promise<TemperatureReading> => readTemperatures(),
    restart: performRestart,
    shutdown: performShutdown,
    installStartup,
    uninstallStartup,
    runDiagnostics: collectWindowsDiagnostics,
  };
}
