import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ThermalEngine, type CycleResult } from "../src/core/engine.js";
import { DryRunPowerExecutor } from "../src/core/power.js";
import { ActionLock } from "../src/core/state.js";
import type { PowerExecutor, TemperatureReading, ThermalPolicy } from "../src/types.js";
import { createRecordingLogger, type RecordingLogger } from "../src/utils/logger.js";
import { FakeExecutor, ThrowingExecutor, makePolicy, makeReading, makeSilentReading } from "./support/factories.js";

type EngineHarness = {
  engine: ThermalEngine;
  lock: ActionLock;
  logger: RecordingLogger;
  process(reading: TemperatureReading): Promise<CycleResult>;
};

function createHarness(
  policy: ThermalPolicy = makePolicy({ requiredSamples: 2 }),
  executor: PowerExecutor = new FakeExecutor(),
): EngineHarness {
  const lock = new ActionLock();
  const logger = createRecordingLogger();
  const engine = new ThermalEngine({ policy, lock, executor, logger });
  return {
    engine,
    lock,
    logger,
    process: (reading: TemperatureReading): Promise<CycleResult> => engine.processReading(reading),
  };
}

describe("ThermalEngine", () => {
  it("does not call the power layer for normal temperatures", async () => {
    const executor = new FakeExecutor();
    const harness = createHarness(makePolicy(), executor);
    const result = await harness.process(makeReading({ cpu: 50, gpu: 45 }));

    assert.equal(result.action, null);
    assert.equal(result.actionOutcome, null);
    assert.equal(executor.calls.length, 0);
    assert.equal(harness.lock.locked, false);
  });

  it("performs the configured action after enough consecutive violations", async () => {
    const executor = new FakeExecutor();
    const harness = createHarness(makePolicy({ requiredSamples: 3 }), executor);

    const first = await harness.process(makeReading({ cpu: 93 }));
    const second = await harness.process(makeReading({ cpu: 94 }));
    const third = await harness.process(makeReading({ cpu: 95 }));

    assert.equal(first.action, null);
    assert.equal(second.action, null);
    assert.equal(third.action, "shutdown");
    assert.equal(executor.calls.length, 1);
    assert.equal(executor.calls[0]?.action, "shutdown");
    assert.equal(harness.lock.locked, true);
  });

  it("skips further evaluation while a real action is in progress", async () => {
    const executor = new FakeExecutor();
    const harness = createHarness(makePolicy({ requiredSamples: 1 }), executor);

    const first = await harness.process(makeReading({ cpu: 99 }));
    const second = await harness.process(makeReading({ cpu: 99 }));

    assert.equal(first.action, "shutdown");
    assert.equal(second.action, null);
    assert.equal(second.skipped, "action-in-progress");
    assert.equal(executor.calls.length, 1);
  });

  it("acquires and releases the action lock for dry-run actions", async () => {
    const lock = new ActionLock();
    const logger = createRecordingLogger();
    const engine = new ThermalEngine({
      policy: makePolicy({ requiredSamples: 1 }),
      lock,
      executor: new DryRunPowerExecutor(logger),
      logger,
    });

    const result = await engine.processReading(makeReading({ cpu: 99 }));

    assert.equal(result.action, "shutdown");
    assert.equal(result.actionOutcome?.executed, false);
    assert.equal(result.actionOutcome?.dryRun, true);
    assert.equal(lock.locked, false);
    assert.match(logger.lines.join("\n"), /\[DRY RUN\] Would shutdown system/);
  });

  it("runs one action per thermal incident", async () => {
    const executor = new FakeExecutor();
    const harness = createHarness(makePolicy({ requiredSamples: 1 }), executor);

    await harness.process(makeReading({ cpu: 99 }));
    await harness.process(makeReading({ cpu: 99 }));
    const stillHot = await harness.process(makeReading({ cpu: 99 }));

    assert.equal(stillHot.action, null);
    assert.equal(executor.calls.length, 1);
  });

  it("allows a new action after a non-destructive incident recovers", async () => {
    const executor = new FakeExecutor();
    executor.executed = false;
    executor.dryRun = true;
    const harness = createHarness(makePolicy({ requiredSamples: 1 }), executor);

    await harness.process(makeReading({ cpu: 99 }));
    await harness.process(makeReading({ cpu: 40 }));
    const second = await harness.process(makeReading({ cpu: 99 }));

    assert.equal(second.action, "shutdown");
    assert.equal(executor.calls.length, 2);
  });

  it("releases the lock when the power layer fails", async () => {
    const executor = new ThrowingExecutor();
    const harness = createHarness(makePolicy({ requiredSamples: 1 }), executor);

    const result = await harness.process(makeReading({ cpu: 99 }));

    assert.equal(executor.calls, 1);
    assert.equal(result.actionOutcome?.executed, false);
    assert.match(result.actionOutcome?.message ?? "", /power layer exploded/);
    assert.equal(harness.lock.locked, false);
  });

  it("performs a single action when several thresholds cross at once", async () => {
    const executor = new FakeExecutor();
    const harness = createHarness(makePolicy({ requiredSamples: 1 }), executor);
    const result = await harness.process(makeReading({ cpu: 99, gpu: 99 }));

    assert.match(result.reason ?? "", /CPU reached 99 C/);
    assert.match(result.reason ?? "", /GPU reached 99 C/);
    assert.equal(executor.calls.length, 1);
  });

  it("still protects the CPU when the GPU sensor is unavailable", async () => {
    const executor = new FakeExecutor();
    const harness = createHarness(makePolicy({ requiredSamples: 1 }), executor);
    const gpuUnavailable = makeReading({ cpu: 99, gpu: null });

    const result = await harness.process(gpuUnavailable);

    assert.equal(result.reading.gpu.max, null);
    assert.equal(result.action, "shutdown");
    assert.match(result.reason ?? "", /CPU reached 99 C/);
    assert.equal(executor.calls.length, 1);
  });

  it("still protects the GPU when the CPU sensor is unavailable", async () => {
    const executor = new FakeExecutor();
    const harness = createHarness(makePolicy({ requiredSamples: 1 }), executor);
    const cpuUnavailable = makeReading({ cpu: null, gpu: 99 });

    const result = await harness.process(cpuUnavailable);

    assert.equal(result.reading.cpu.max, null);
    assert.equal(result.action, "shutdown");
    assert.match(result.reason ?? "", /GPU reached 99 C/);
    assert.equal(executor.calls.length, 1);
  });

  it("warns about missing sensors only once", async () => {
    const harness = createHarness();
    await harness.process(makeSilentReading());
    await harness.process(makeSilentReading());
    await harness.process(makeSilentReading());

    const warnings = harness.logger.lines.filter((line) => line.includes("CPU temperature sensors are unavailable"));
    assert.equal(warnings.length, 1);
    assert.match(harness.logger.lines.join("\n"), /no usable temperature sensor/i);
  });

  it("warns again after a missing sensor recovers and disappears", async () => {
    const harness = createHarness();
    await harness.process(makeSilentReading());
    await harness.process(makeReading({ cpu: 50 }));
    await harness.process(makeSilentReading());

    const warnings = harness.logger.lines.filter((line) => line.includes("CPU temperature sensors are unavailable"));
    assert.equal(warnings.length, 2);
  });
});
