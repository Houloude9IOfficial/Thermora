import { toThermalPolicy } from "../../config/config.js";
import { formatSimulationReport } from "../../services/report.js";
import { runSimulation } from "../../services/simulation.js";
import { silentLogger } from "../../utils/logger.js";
import { writeLines } from "../io.js";
import type { Options } from "../args.js";
import type { CliCommand, CommandContext } from "../types.js";

type TemperatureFlag = {
  value: number | null;
  message: string | null;
};

const MAX_SIMULATED_TEMPERATURE = 200;

function readTemperatureFlag(options: Options, name: string): TemperatureFlag {
  const raw = options.value(name);
  if (raw === null) return { value: null, message: null };
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) {
    return { value: null, message: `--${name} expects a numeric temperature in degrees Celsius` };
  }
  if (value < 0 || value > MAX_SIMULATED_TEMPERATURE) {
    return {
      value: null,
      message: `--${name} expects a temperature between 0 and ${MAX_SIMULATED_TEMPERATURE} C`,
    };
  }
  return { value, message: null };
}

function readCycles(options: Options, fallback: number): { value: number; message: string | null } {
  const raw = options.value("cycles");
  if (raw === null) return { value: fallback, message: null };
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    return { value: fallback, message: "--cycles expects an integer between 1 and 1000" };
  }
  return { value, message: null };
}

export const simulateCommand: CliCommand = {
  name: "simulate",
  summary: "Simulate temperatures through the real evaluator without executing any power action",
  usage: "thermora simulate [--cpu <c>] [--gpu <c>] [--cycles <n>] [--json]",
  async run(context: CommandContext): Promise<number> {
    const cpu = readTemperatureFlag(context.options, "cpu");
    const gpu = readTemperatureFlag(context.options, "gpu");
    const cycles = readCycles(context.options, context.config.requiredSamples);

    for (const issue of [cpu.message, gpu.message, cycles.message]) {
      if (issue !== null) {
        context.io.writeError(issue);
        return 2;
      }
    }

    if (cpu.value === null && gpu.value === null) {
      context.io.writeError("Provide at least one simulated temperature, for example --cpu 95 or --gpu 98");
      return 2;
    }

    const result = await runSimulation({
      policy: toThermalPolicy(context.config),
      cycles: cycles.value,
      cpu: cpu.value,
      gpu: gpu.value,
      logger: silentLogger,
    });

    if (context.options.has("json")) {
      context.io.write(
        JSON.stringify(
          {
            platform: context.adapter.name,
            dryRun: context.config.dryRun,
            mode: "simulation",
            cpu: cpu.value,
            gpu: gpu.value,
            cycles: cycles.value,
            action: result.action,
            reason: result.reason,
            executed: result.executed,
            steps: result.cycles,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    context.io.write(`Platform: ${context.adapter.name}`);
    context.io.write(`Action: ${context.config.action}`);
    context.io.write(
      `Limits: CPU ${context.config.cpuMax} C, GPU ${context.config.gpuMax} C, global ${context.config.globalMax} C (${context.config.requiredSamples} consecutive sample(s))`,
    );
    context.io.write("");
    writeLines(context.io, formatSimulationReport(result));
    return 0;
  },
};
