import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTemperatureReading, hasTemperatureData, maxTemperature, normalizeTemperature } from "../src/utils/sensors.js";

describe("normalizeTemperature", () => {
  it("accepts plausible sensor values", () => {
    assert.equal(normalizeTemperature(1), 1);
    assert.equal(normalizeTemperature(67.4), 67.4);
    assert.equal(normalizeTemperature(149), 149);
    assert.equal(normalizeTemperature(150), 150);
  });

  it("rejects values that are not real sensor readings", () => {
    assert.equal(normalizeTemperature(0), null);
    assert.equal(normalizeTemperature(-1), null);
    assert.equal(normalizeTemperature(-999), null);
    assert.equal(normalizeTemperature(151), null);
    assert.equal(normalizeTemperature(1000), null);
    assert.equal(normalizeTemperature(Number.NaN), null);
    assert.equal(normalizeTemperature(Number.POSITIVE_INFINITY), null);
    assert.equal(normalizeTemperature(undefined), null);
    assert.equal(normalizeTemperature(null), null);
    assert.equal(normalizeTemperature("42"), null);
  });
});

describe("maxTemperature", () => {
  it("ignores invalid values and returns null when nothing is valid", () => {
    assert.equal(maxTemperature([-1, Number.NaN, 200]), null);
    assert.equal(maxTemperature([]), null);
  });

  it("returns the highest valid value", () => {
    assert.equal(maxTemperature([55, 71, -5, null, undefined, 64]), 71);
  });
});

describe("buildTemperatureReading", () => {
  it("never turns missing sensor data into zero", () => {
    const reading = buildTemperatureReading({
      cpu: { main: -1, max: -1, cores: [-1, -1] },
      gpuDevices: [{ name: "NVIDIA", vendor: "NVIDIA", temperature: -1 }],
    });

    assert.equal(reading.cpu.main, null);
    assert.equal(reading.cpu.max, null);
    assert.deepEqual(reading.cpu.cores, []);
    assert.equal(reading.gpu.max, null);
    assert.equal(reading.global.max, null);
    assert.equal(hasTemperatureData(reading), false);
  });

  it("computes the maximum CPU temperature from main, max and cores", () => {
    const reading = buildTemperatureReading({
      cpu: { main: 55, max: 60, cores: [58, 82, 61] },
      gpuDevices: [],
    });

    assert.equal(reading.cpu.main, 55);
    assert.equal(reading.cpu.max, 82);
    assert.deepEqual(reading.cpu.cores, [58, 82, 61]);
  });

  it("supports multiple GPUs and reports the maximum across devices", () => {
    const reading = buildTemperatureReading({
      cpu: { main: 50 },
      gpuDevices: [
        { name: "Discrete", vendor: "NVIDIA", temperature: 71 },
        { name: "Integrated", vendor: "Intel", temperature: 48 },
        { name: "Unavailable", vendor: null, temperature: -1 },
      ],
    });

    assert.equal(reading.gpu.devices.length, 3);
    assert.equal(reading.gpu.max, 71);
    assert.equal(reading.gpu.devices[1]?.vendor, "Intel");
    assert.equal(reading.gpu.devices[2]?.temperature, null);
  });

  it("falls back to a placeholder name for unnamed GPUs", () => {
    const reading = buildTemperatureReading({
      cpu: {},
      gpuDevices: [{ name: "   ", vendor: "  ", temperature: 40 }],
    });

    assert.equal(reading.gpu.devices[0]?.name, "Unknown GPU");
    assert.equal(reading.gpu.devices[0]?.vendor, null);
  });

  it("calculates the global maximum from every usable reading", () => {
    const reading = buildTemperatureReading({
      cpu: { main: 61, max: 66, cores: [63] },
      gpuDevices: [{ name: "GPU", vendor: "AMD", temperature: 88 }],
    });

    assert.equal(reading.global.max, 88);
  });

  it("calculates the global maximum from the CPU when no GPU is available", () => {
    const reading = buildTemperatureReading({
      cpu: { main: 61, max: 66, cores: [63] },
      gpuDevices: [],
    });

    assert.equal(reading.gpu.max, null);
    assert.equal(reading.global.max, 66);
    assert.equal(hasTemperatureData(reading), true);
  });
});
