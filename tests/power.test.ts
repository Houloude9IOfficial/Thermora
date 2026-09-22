import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdapterPowerExecutor, DryRunPowerExecutor } from "../src/core/power.js";
import { createRecordingLogger } from "../src/utils/logger.js";
import { FakeAdapter } from "./support/factories.js";

describe("DryRunPowerExecutor", () => {
  it("never reaches the platform adapter", async () => {
    const adapter = new FakeAdapter();
    const logger = createRecordingLogger();
    const executor = new DryRunPowerExecutor(logger);

    const shutdown = await executor.execute("shutdown", "CPU reached 99 C");
    const restart = await executor.execute("restart", "GPU reached 99 C");

    assert.equal(shutdown.executed, false);
    assert.equal(shutdown.dryRun, true);
    assert.equal(restart.executed, false);
    assert.equal(adapter.shutdownCalls, 0);
    assert.equal(adapter.restartCalls, 0);
    assert.match(logger.lines.join("\n"), /\[DRY RUN\] Would shutdown system/);
    assert.match(logger.lines.join("\n"), /\[DRY RUN\] Would restart system/);
  });
});

describe("AdapterPowerExecutor", () => {
  it("routes shutdown and restart through the platform adapter", async () => {
    const adapter = new FakeAdapter();
    const logger = createRecordingLogger();
    const executor = new AdapterPowerExecutor(adapter, logger);

    const shutdown = await executor.execute("shutdown", "CPU reached 99 C");
    const restart = await executor.execute("restart", "GPU reached 99 C");

    assert.equal(shutdown.executed, true);
    assert.equal(restart.executed, true);
    assert.equal(adapter.shutdownCalls, 1);
    assert.equal(adapter.restartCalls, 1);
  });

  it("reports a failed power action instead of crashing", async () => {
    const adapter = new FakeAdapter();
    adapter.shutdownError = new Error("permission denied");
    const logger = createRecordingLogger();
    const executor = new AdapterPowerExecutor(adapter, logger);

    const outcome = await executor.execute("shutdown", "CPU reached 99 C");

    assert.equal(outcome.executed, false);
    assert.match(outcome.message, /permission denied/);
    assert.match(logger.lines.join("\n"), /Failed to perform shutdown/);
  });
});
