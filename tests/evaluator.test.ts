import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createViolationCounters, evaluateReading } from "../src/core/evaluator.js";
import type { EvaluationOutcome, TemperatureReading, ThermalPolicy } from "../src/types.js";
import { makePolicy, makeReading, makeSilentReading } from "./support/factories.js";

function evaluateSequence(
  readings: readonly TemperatureReading[],
  policy: ThermalPolicy,
): EvaluationOutcome[] {
  let counters = createViolationCounters();
  const outcomes: EvaluationOutcome[] = [];
  for (const reading of readings) {
    const outcome = evaluateReading(reading, policy, counters);
    counters = outcome.counters;
    outcomes.push(outcome);
  }
  return outcomes;
}

describe("evaluateReading", () => {
  it("takes no action for normal temperatures", () => {
    const outcome = evaluateReading(makeReading({ cpu: 61, gpu: 55 }), makePolicy(), createViolationCounters());
    assert.equal(outcome.action, null);
    assert.equal(outcome.reason, null);
    assert.deepEqual(outcome.counters, { cpu: 0, gpu: 0, global: 0 });
    assert.equal(outcome.statuses.every((status) => !status.exceeded), true);
  });

  it("triggers the CPU threshold only after the required consecutive samples", () => {
    const policy = makePolicy({ requiredSamples: 3 });
    const outcomes = evaluateSequence(
      [makeReading({ cpu: 91 }), makeReading({ cpu: 92 }), makeReading({ cpu: 93 })],
      policy,
    );

    assert.equal(outcomes[0]?.action, null);
    assert.equal(outcomes[0]?.counters.cpu, 1);
    assert.equal(outcomes[1]?.action, null);
    assert.equal(outcomes[1]?.counters.cpu, 2);
    assert.equal(outcomes[2]?.action, "shutdown");
    assert.equal(outcomes[2]?.counters.cpu, 3);
    assert.match(outcomes[2]?.reason ?? "", /CPU reached 93 C \(limit 90 C\)/);
  });

  it("treats a temperature exactly at the threshold as acceptable", () => {
    const policy = makePolicy({ requiredSamples: 1 });
    const outcome = evaluateReading(makeReading({ cpu: 90 }), policy, createViolationCounters());
    assert.equal(outcome.action, null);
    assert.equal(outcome.counters.cpu, 0);
  });

  it("resets the violation counter once the temperature falls back below the threshold", () => {
    const policy = makePolicy({ requiredSamples: 3 });
    const outcomes = evaluateSequence(
      [
        makeReading({ cpu: 95 }),
        makeReading({ cpu: 96 }),
        makeReading({ cpu: 70 }),
        makeReading({ cpu: 95 }),
        makeReading({ cpu: 95 }),
      ],
      policy,
    );

    assert.equal(outcomes[0]?.counters.cpu, 1);
    assert.equal(outcomes[1]?.counters.cpu, 2);
    assert.equal(outcomes[2]?.counters.cpu, 0);
    assert.equal(outcomes[2]?.action, null);
    assert.equal(outcomes[3]?.counters.cpu, 1);
    assert.equal(outcomes[3]?.action, null);
    assert.equal(outcomes[4]?.counters.cpu, 2);
    assert.equal(outcomes[4]?.action, null);
  });

  it("tracks the GPU threshold independently from the CPU", () => {
    const policy = makePolicy({ requiredSamples: 2 });
    const outcomes = evaluateSequence(
      [
        makeReading({ cpu: 60, gpu: 99 }),
        makeReading({ cpu: 60, gpu: 99 }),
        makeReading({ cpu: 60, gpu: 40 }),
        makeReading({ cpu: 60, gpu: 99 }),
      ],
      policy,
    );

    assert.equal(outcomes[0]?.action, null);
    assert.equal(outcomes[0]?.counters.gpu, 1);
    assert.equal(outcomes[1]?.action, "shutdown");
    assert.match(outcomes[1]?.reason ?? "", /GPU reached 99 C/);
    assert.equal(outcomes[2]?.counters.gpu, 0);
    assert.equal(outcomes[3]?.action, null);
    assert.equal(outcomes[3]?.counters.gpu, 1);
  });

  it("triggers the global threshold when a derived maximum exceeds it", () => {
    const policy = makePolicy({ globalMax: 95, gpuMax: 120, requiredSamples: 2 });
    const outcomes = evaluateSequence([makeReading({ cpu: 40, gpu: 97 }), makeReading({ cpu: 40, gpu: 98 })], policy);

    assert.equal(outcomes[1]?.action, "shutdown");
    assert.match(outcomes[1]?.reason ?? "", /Global reached 98 C \(limit 95 C\)/);
  });

  it("reports every threshold crossed in the same cycle with a single action", () => {
    const policy = makePolicy({ requiredSamples: 1 });
    const outcome = evaluateReading(makeReading({ cpu: 99, gpu: 99 }), policy, createViolationCounters());

    assert.equal(outcome.action, "shutdown");
    assert.match(outcome.reason ?? "", /CPU reached 99 C/);
    assert.match(outcome.reason ?? "", /GPU reached 99 C/);
    assert.match(outcome.reason ?? "", /Global reached 99 C/);
  });

  it("keeps counters independent for each threshold", () => {
    const policy = makePolicy({ requiredSamples: 2 });
    const outcomes = evaluateSequence(
      [makeReading({ cpu: 96, gpu: 40 }), makeReading({ cpu: 96, gpu: 96 }), makeReading({ cpu: 96, gpu: 96 })],
      policy,
    );

    assert.deepEqual(outcomes[0]?.counters, { cpu: 1, gpu: 0, global: 1 });
    assert.deepEqual(outcomes[1]?.counters, { cpu: 2, gpu: 1, global: 2 });
    assert.equal(outcomes[1]?.action, "shutdown");
    assert.deepEqual(outcomes[2]?.counters, { cpu: 3, gpu: 2, global: 3 });
  });

  it("does not count missing sensors as violations and resets their counters", () => {
    const policy = makePolicy({ requiredSamples: 1 });
    const withData = evaluateReading(makeReading({ cpu: 99 }), policy, createViolationCounters());
    assert.equal(withData.action, "shutdown");

    const withoutData = evaluateReading(makeSilentReading(), policy, withData.counters);
    assert.equal(withoutData.action, null);
    assert.deepEqual(withoutData.counters, { cpu: 0, gpu: 0, global: 0 });
    assert.equal(withoutData.statuses.every((status) => status.temperature === null), true);
  });

  it("uses the policy action for the decision", () => {
    const policy = makePolicy({ requiredSamples: 1 });
    const outcome = evaluateReading(makeReading({ cpu: 99 }), { ...policy, action: "restart" }, createViolationCounters());
    assert.equal(outcome.action, "restart");
  });
});
