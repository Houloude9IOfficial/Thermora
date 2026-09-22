import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ThermalEngine } from "../src/core/engine.js";
import { Monitor } from "../src/core/monitor.js";
import { ActionLock } from "../src/core/state.js";
import { createRecordingLogger } from "../src/utils/logger.js";
import { FakeAdapter, FakeExecutor, makePolicy, makeReading } from "./support/factories.js";

function createMonitor(adapter: FakeAdapter, pollIntervalMs: number, cycles: string[] = []) {
  const logger = createRecordingLogger();
  const lock = new ActionLock();
  const engine = new ThermalEngine({ policy: makePolicy(), lock, executor: new FakeExecutor(), logger });
  const monitor = new Monitor({
    adapter,
    engine,
    logger,
    pollIntervalMs,
    onCycle: (): void => void cycles.push("cycle"),
  });
  return { monitor, logger };
}

describe("Monitor", () => {
  it("never overlaps temperature reads when polling is slower than the interval", async () => {
    const adapter = new FakeAdapter({ delayMs: 40 });
    const { monitor } = createMonitor(adapter, 5);

    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 180));
    await monitor.stop();

    assert.equal(adapter.maxConcurrentCalls, 1);
    assert.ok(adapter.temperatureCalls >= 2, "expected several polling cycles");
  });

  it("stops polling after stop()", async () => {
    const adapter = new FakeAdapter({ delayMs: 0 });
    const { monitor } = createMonitor(adapter, 5);

    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await monitor.stop();
    const callsAfterStop = adapter.temperatureCalls;

    assert.equal(monitor.isRunning, false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(adapter.temperatureCalls, callsAfterStop);
  });

  it("keeps monitoring after a recoverable sensor failure", async () => {
    const adapter = new FakeAdapter({ failures: 1, reading: makeReading({ cpu: 50 }) });
    const cycles: string[] = [];
    const { monitor, logger } = createMonitor(adapter, 5, cycles);

    monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await monitor.stop();

    assert.match(logger.lines.join("\n"), /Monitoring cycle failed/);
    assert.ok(cycles.length >= 1, "expected monitoring to continue after the failure");
  });

  it("does nothing when stopped before it starts", async () => {
    const adapter = new FakeAdapter();
    const { monitor } = createMonitor(adapter, 5);

    await monitor.stop();

    assert.equal(adapter.temperatureCalls, 0);
    assert.equal(monitor.isRunning, false);
  });
});
