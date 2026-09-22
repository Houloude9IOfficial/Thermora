import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSimulatedReading, runSimulation, SimulationPowerExecutor } from "../src/services/simulation.js";
import { createRecordingLogger } from "../src/utils/logger.js";
import { makePolicy } from "./support/factories.js";

describe("buildSimulatedReading", () => {
  it("produces a normalized reading from simulated values", () => {
    const reading = buildSimulatedReading({ cpu: 95, gpu: 70 });
    assert.equal(reading.cpu.main, 95);
    assert.equal(reading.cpu.max, 95);
    assert.equal(reading.gpu.max, 70);
    assert.equal(reading.global.max, 95);
  });

  it("keeps unavailable sensors unavailable", () => {
    const reading = buildSimulatedReading({ cpu: null, gpu: 70 });
    assert.equal(reading.cpu.main, null);
    assert.equal(reading.cpu.max, null);
    assert.deepEqual(reading.cpu.cores, []);
    assert.equal(reading.global.max, 70);
  });
});

describe("SimulationPowerExecutor", () => {
  it("records the action without executing it", async () => {
    const logger = createRecordingLogger();
    const executor = new SimulationPowerExecutor(logger);

    const outcome = await executor.execute("shutdown", "CPU reached 95 C");

    assert.equal(outcome.executed, false);
    assert.equal(outcome.simulated, true);
    assert.equal(executor.actions.length, 1);
    assert.match(logger.lines.join("\n"), /\[SIMULATION\] Would shutdown system/);
  });
});

describe("runSimulation", () => {
  it("decides an action after the required consecutive samples", async () => {
    const logger = createRecordingLogger();
    const result = await runSimulation({
      policy: makePolicy({ requiredSamples: 3 }),
      cycles: 3,
      cpu: 95,
      gpu: 70,
      logger,
    });

    assert.equal(result.action, "shutdown");
    assert.match(result.reason ?? "", /CPU reached 95 C/);
    assert.equal(result.cycles.length, 3);
    assert.deepEqual(
      result.cycles.map((cycle) => cycle.counters.cpu),
      [1, 2, 3],
    );
    assert.equal(result.executed, false);
  });

  it("never executes a real action even when enforcing is configured", async () => {
    const logger = createRecordingLogger();
    const result = await runSimulation({
      policy: makePolicy({ requiredSamples: 1, cpuMax: 60, gpuMax: 60, globalMax: 60 }),
      cycles: 5,
      cpu: 120,
      gpu: 120,
      logger,
    });

    assert.equal(result.action, "shutdown");
    assert.equal(result.executed, false);
    assert.equal(result.simulated, true);
  });

  it("honours the configured restart action", async () => {
    const logger = createRecordingLogger();
    const result = await runSimulation({
      policy: { limits: { cpuMax: 60, gpuMax: 60, globalMax: 60, requiredSamples: 1 }, action: "restart" },
      cycles: 1,
      cpu: 90,
      gpu: null,
      logger,
    });

    assert.equal(result.action, "restart");
  });

  it("triggers the global threshold from a GPU reading", async () => {
    const logger = createRecordingLogger();
    const result = await runSimulation({
      policy: makePolicy({ requiredSamples: 2, gpuMax: 120, globalMax: 95 }),
      cycles: 2,
      cpu: 40,
      gpu: 98,
      logger,
    });

    assert.equal(result.action, "shutdown");
    assert.match(result.reason ?? "", /Global reached 98 C/);
    assert.equal(result.executed, false);
  });

  it("takes no action when simulated temperatures stay inside the limits", async () => {
    const logger = createRecordingLogger();
    const result = await runSimulation({
      policy: makePolicy({ requiredSamples: 2 }),
      cycles: 2,
      cpu: 60,
      gpu: 55,
      logger,
    });

    assert.equal(result.action, null);
    assert.equal(result.reason, null);
    assert.equal(result.simulated, false);
    assert.equal(result.executed, false);
  });
});
