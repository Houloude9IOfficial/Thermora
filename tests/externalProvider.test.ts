import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LINUX_PROVIDER,
  MACOS_PROVIDER,
  WINDOWS_PROVIDER,
  isProviderCoolingDown,
  mergeSensorSources,
  parseProviderTemperatures,
  readExternalTemperatures,
  readProviderConfiguration,
  resetProviderState,
  type InternalTemperatureSources,
} from "../src/platforms/externalProvider.js";
import { FailureCooldown } from "../src/utils/cooldown.js";
import { parseAcpiTemperatures } from "../src/platforms/windows/tempWatch.js";
import { buildTemperatureReading } from "../src/utils/sensors.js";

function internalSources(overrides: Partial<InternalTemperatureSources> = {}): InternalTemperatureSources {
  return {
    cpu: { main: null, max: null, cores: [] },
    gpuDevices: [],
    ...overrides,
  };
}

describe("readProviderConfiguration", () => {
  it("is disabled when no command is configured", () => {
    assert.equal(readProviderConfiguration(MACOS_PROVIDER, {}), null);
    assert.equal(readProviderConfiguration(WINDOWS_PROVIDER, {}), null);
    assert.equal(readProviderConfiguration(MACOS_PROVIDER, { THERMORA_MACOS_SENSOR_COMMAND: "   " }), null);
  });

  it("reads the command and whitespace separated arguments", () => {
    const configuration = readProviderConfiguration(MACOS_PROVIDER, {
      THERMORA_MACOS_SENSOR_COMMAND: "/usr/local/bin/smctemp",
      THERMORA_MACOS_SENSOR_ARGS: "  -c   -j ",
    });

    assert.deepEqual(configuration, { command: "/usr/local/bin/smctemp", args: ["-c", "-j"] });
  });

  it("uses platform specific variables for each operating system", () => {
    assert.equal(MACOS_PROVIDER.commandEnv, "THERMORA_MACOS_SENSOR_COMMAND");
    assert.equal(WINDOWS_PROVIDER.commandEnv, "THERMORA_WINDOWS_SENSOR_COMMAND");
    assert.equal(LINUX_PROVIDER.commandEnv, "THERMORA_LINUX_SENSOR_COMMAND");

    const configuration = readProviderConfiguration(WINDOWS_PROVIDER, {
      THERMORA_WINDOWS_SENSOR_COMMAND: "nvidia-smi.exe",
      THERMORA_WINDOWS_SENSOR_ARGS: "--query-gpu=temperature.gpu",
    });

    assert.deepEqual(configuration, { command: "nvidia-smi.exe", args: ["--query-gpu=temperature.gpu"] });
  });
});

describe("parseProviderTemperatures", () => {
  it("treats a single bare value as the CPU temperature", () => {
    assert.deepEqual(parseProviderTemperatures("72.3°C"), { cpu: [72.3], gpu: [] });
    assert.deepEqual(parseProviderTemperatures("45.8 C"), { cpu: [45.8], gpu: [] });
    assert.deepEqual(parseProviderTemperatures("64"), { cpu: [64], gpu: [] });
  });

  it("prettifies well known labels", () => {
    const parsed = parseProviderTemperatures("gpu: 55C\ncpu: 65C");
    assert.deepEqual(parsed.cpu, [65]);
    assert.equal(parsed.gpu[0]?.name, "GPU");
  });

  it("classifies labeled CPU and GPU readings", () => {
    const parsed = parseProviderTemperatures("CPU: 65.2°C\nGPU: 58.9°C");
    assert.deepEqual(parsed.cpu, [65.2]);
    assert.deepEqual(parsed.gpu, [{ name: "GPU", vendor: null, temperature: 58.9 }]);
  });

  it("handles several readings on one line and ignores unrelated sensors", () => {
    const parsed = parseProviderTemperatures("CPU 45.5°C, GPU 42.3°C, Battery 30.0°C");
    assert.deepEqual(parsed.cpu, [45.5]);
    assert.equal(parsed.gpu.length, 1);
    assert.equal(parsed.gpu[0]?.name, "GPU");
    assert.equal(parsed.gpu[0]?.temperature, 42.3);
  });

  it("accepts key value formats common to hardware helpers", () => {
    const parsed = parseProviderTemperatures("cpu_temp=45.5C gpu_temp = 43.2C");
    assert.deepEqual(parsed.cpu, [45.5]);
    assert.equal(parsed.gpu[0]?.temperature, 43.2);
  });

  it("keeps per core readings as separate CPU values", () => {
    const parsed = parseProviderTemperatures("CPU core 1: 61.0C\nCPU core 2: 66.5C\nCPU core 3: 59.0C");
    assert.deepEqual(parsed.cpu, [61, 66.5, 59]);
  });

  it("parses temperature keys from JSON output", () => {
    const parsed = parseProviderTemperatures(
      JSON.stringify({ temp: { cpu_temp_avg: 45.5, gpu_temp_avg: 41.2 }, gpu_usage: 12 }),
    );

    assert.deepEqual(parsed.cpu, [45.5]);
    assert.equal(parsed.gpu.length, 1);
    assert.equal(parsed.gpu[0]?.temperature, 41.2);
    assert.equal(parsed.gpu[0]?.name, "GPU");
  });

  it("parses nested JSON arrays of sensors", () => {
    const parsed = parseProviderTemperatures(
      JSON.stringify({ sensors: [{ name: "CPU package", temperature: 66 }, { name: "GPU die", temperature: 55 }] }),
    );

    assert.deepEqual(parsed.cpu, [66]);
    assert.equal(parsed.gpu.length, 1);
    assert.equal(parsed.gpu[0]?.name, "GPU die");
  });

  it("parses one JSON object per line, as streamed helpers do", () => {
    const output = [
      JSON.stringify({ temp: { cpu_temp_avg: 45.5, gpu_temp_avg: 41.2 } }),
      JSON.stringify({ temp: { cpu_temp_avg: 47.1, gpu_temp_avg: 43 } }),
    ].join("\n");

    const parsed = parseProviderTemperatures(output);
    assert.deepEqual(parsed.cpu, [45.5, 47.1]);
    assert.equal(parsed.gpu.length, 2);
    assert.equal(parsed.gpu[1]?.temperature, 43);
  });

  it("falls back to text parsing when JSON has no temperatures", () => {
    assert.deepEqual(parseProviderTemperatures('{"status":"ok","cpu_temp_avg":0}'), { cpu: [], gpu: [] });
    assert.deepEqual(parseProviderTemperatures('{"status":"ok"}\n61.5'), { cpu: [61.5], gpu: [] });
  });

  it("ignores values that are not temperatures", () => {
    const parsed = parseProviderTemperatures("Fan: 2000 rpm\nPower: 3.5 W\nSMC keys: 4\nCPU: 55C");
    assert.deepEqual(parsed.cpu, [55]);
    assert.deepEqual(parsed.gpu, []);
  });

  it("rejects implausible and missing sensor values", () => {
    const parsed = parseProviderTemperatures("CPU: -1C\nGPU: 0C\nCPU die: 400C");
    assert.deepEqual(parsed, { cpu: [], gpu: [] });
  });

  it("returns nothing for empty or unrelated output", () => {
    assert.deepEqual(parseProviderTemperatures(""), { cpu: [], gpu: [] });
    assert.deepEqual(parseProviderTemperatures("no sensors available\n"), { cpu: [], gpu: [] });
  });
});

describe("readExternalTemperatures", () => {
  it("is inactive when not configured", async () => {
    const outcome = await readExternalTemperatures(MACOS_PROVIDER, null);
    assert.equal(outcome.configured, false);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, null);
  });

  it("runs the configured command and returns normalized readings", async () => {
    resetProviderState();
    const outcome = await readExternalTemperatures(MACOS_PROVIDER, {
      command: process.execPath,
      args: ["-e", "process.stdout.write('CPU:66.5C,GPU:55.0C')"],
    });

    assert.equal(outcome.ok, true);
    assert.deepEqual(outcome.cpu, [66.5]);
    assert.equal(outcome.gpu[0]?.temperature, 55);
    assert.equal(outcome.error, null);
  });

  it("reports a missing command instead of throwing", async () => {
    resetProviderState();
    const outcome = await readExternalTemperatures(WINDOWS_PROVIDER, {
      command: "thermora-missing-provider",
      args: [],
    });

    assert.equal(outcome.ok, false);
    assert.match(outcome.error ?? "", /was not found/);
  });

  it("reports unusable output with an excerpt", async () => {
    resetProviderState();
    const outcome = await readExternalTemperatures(MACOS_PROVIDER, {
      command: process.execPath,
      args: ["-e", "process.stdout.write('nosensorsfound')"],
    });

    assert.equal(outcome.ok, false);
    assert.match(outcome.error ?? "", /no recognizable temperature/);
    assert.match(outcome.error ?? "", /nosensorsfound/);
  });

  it("stops retrying a failing provider until the cooldown expires", async () => {
    resetProviderState();
    const configuration = { command: "thermora-missing-provider", args: [] };

    const first = await readExternalTemperatures(MACOS_PROVIDER, configuration);
    assert.equal(first.ok, false);
    assert.equal(isProviderCoolingDown("thermora-missing-provider"), true);

    const startedAt = Date.now();
    const second = await readExternalTemperatures(MACOS_PROVIDER, configuration);
    assert.equal(second.ok, false);
    assert.equal(second.error, first.error);
    assert.ok(Date.now() - startedAt < 100, "expected the cooldown to skip running the command");

    resetProviderState();
    assert.equal(isProviderCoolingDown("thermora-missing-provider"), false);
  });
});

describe("FailureCooldown", () => {
  it("expires after the configured duration", () => {
    let now = 1_000;
    const cooldown = new FailureCooldown<string>(500, () => now);

    assert.equal(cooldown.active("probe"), false);
    cooldown.record("probe", "broken");
    assert.equal(cooldown.active("probe"), true);
    assert.equal(cooldown.get("probe"), "broken");

    now += 499;
    assert.equal(cooldown.active("probe"), true);
    now += 1;
    assert.equal(cooldown.active("probe"), false);

    cooldown.clear("probe");
    assert.equal(cooldown.get("probe"), null);
  });
});

describe("parseAcpiTemperatures", () => {
  it("converts tenths of Kelvin into Celsius", () => {
    assert.deepEqual(parseAcpiTemperatures("3012\n3120"), [28.05, 38.85]);
  });

  it("ignores unusable values and noise", () => {
    assert.deepEqual(parseAcpiTemperatures(""), []);
    assert.deepEqual(parseAcpiTemperatures("notanumber 99999"), []);
    assert.deepEqual(parseAcpiTemperatures("2982 3012"), [25.05, 28.05]);
  });

  it("rejects readings outside a plausible range", () => {
    assert.deepEqual(parseAcpiTemperatures("1000 5000"), []);
  });
});

describe("mergeSensorSources", () => {
  it("fills an unavailable CPU reading from the external provider", () => {
    const merged = mergeSensorSources(internalSources(), { cpu: [70.5, 68], gpu: [] });

    assert.equal(merged.cpu.main, 70.5);
    assert.deepEqual(merged.cpu.cores, [70.5, 68]);
    assert.equal(buildTemperatureReading({ cpu: merged.cpu, gpuDevices: merged.gpuDevices }).cpu.max, 70.5);
  });

  it("never overrides a first-party CPU reading", () => {
    const merged = mergeSensorSources(internalSources({ cpu: { main: 51, max: 57, cores: [55] } }), {
      cpu: [99],
      gpu: [],
    });

    assert.deepEqual(merged.cpu, { main: 51, max: 57, cores: [55] });
  });

  it("fills an unavailable GPU reading from the external provider", () => {
    const merged = mergeSensorSources(internalSources(), {
      cpu: [],
      gpu: [{ name: "GPU die", vendor: null, temperature: 58.9 }],
    });

    assert.deepEqual(merged.gpuDevices, [{ name: "GPU die", vendor: null, temperature: 58.9 }]);
  });

  it("keeps an available GPU device list untouched", () => {
    const merged = mergeSensorSources(
      internalSources({ gpuDevices: [{ name: "Apple M5", vendor: "Apple", temperature: 44 }] }),
      { cpu: [], gpu: [{ name: "GPU", vendor: null, temperature: 91 }] },
    );

    assert.deepEqual(merged.gpuDevices, [{ name: "Apple M5", vendor: "Apple", temperature: 44 }]);
  });

  it("fills both categories when neither is available", () => {
    const merged = mergeSensorSources(internalSources(), {
      cpu: [61],
      gpu: [{ name: "GPU", vendor: null, temperature: 55 }],
    });
    const reading = buildTemperatureReading({ cpu: merged.cpu, gpuDevices: merged.gpuDevices });

    assert.equal(reading.cpu.max, 61);
    assert.equal(reading.gpu.max, 55);
    assert.equal(reading.global.max, 61);
  });

  it("leaves the reading empty when nothing is available", () => {
    const merged = mergeSensorSources(internalSources(), { cpu: [], gpu: [] });
    const reading = buildTemperatureReading({ cpu: merged.cpu, gpuDevices: merged.gpuDevices });

    assert.equal(reading.global.max, null);
  });
});
