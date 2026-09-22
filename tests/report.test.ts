import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseConfig } from "../src/config/config.js";
import {
  buildDoctorReport,
  describeDaemonRuntime,
  formatDoctorReport,
  formatSensorReport,
  formatSimulationReport,
  formatStatusReport,
  type StatusReport,
} from "../src/services/report.js";
import { runSimulation } from "../src/services/simulation.js";
import { silentLogger } from "../src/utils/logger.js";
import type { DaemonStatusSnapshot } from "../src/types.js";
import { FakeAdapter, makePolicy, makeReading } from "./support/factories.js";

function baseStatusReport(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    version: "0.1.0",
    platform: "macOS",
    platformId: "macos",
    mode: "DRY RUN",
    dryRun: true,
    action: "shutdown",
    pollIntervalMs: 5000,
    requiredSamples: 3,
    thresholds: { cpu: 90, gpu: 90, global: 95 },
    api: { enabled: false, host: "127.0.0.1", port: 8787 },
    daemon: {
      running: false,
      stale: false,
      pid: null,
      status: null,
      message: null,
      startedAt: null,
      updatedAt: null,
      cycles: 0,
    },
    reading: makeReading({ cpu: 67, gpu: 64 }),
    readingError: null,
    violations: [],
    ...overrides,
  };
}

describe("describeDaemonRuntime", () => {
  it("reports a missing daemon", () => {
    const runtime = describeDaemonRuntime(null);
    assert.equal(runtime.running, false);
    assert.equal(runtime.stale, false);
    assert.equal(runtime.pid, null);
  });

  it("reports a stale state file for a dead pid", () => {
    const snapshot = {
      pid: 2_147_483_646,
      status: "monitoring",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cycles: 12,
    } as DaemonStatusSnapshot;
    const runtime = describeDaemonRuntime(snapshot);
    assert.equal(runtime.running, false);
    assert.equal(runtime.stale, true);
  });

  it("reports a running daemon for the current process", () => {
    const snapshot = {
      pid: process.pid,
      status: "monitoring",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cycles: 4,
    } as DaemonStatusSnapshot;
    const runtime = describeDaemonRuntime(snapshot);
    assert.equal(runtime.running, true);
    assert.equal(runtime.cycles, 4);
  });
});

describe("formatStatusReport", () => {
  it("summarizes configuration, daemon state and temperatures", () => {
    const lines = formatStatusReport(baseStatusReport()).join("\n");

    assert.match(lines, /Thermora v0\.1\.0/);
    assert.match(lines, /Platform: macOS \(macos\)/);
    assert.match(lines, /Mode: DRY RUN/);
    assert.match(lines, /CPU limit: 90 C/);
    assert.match(lines, /Global limit: 95 C/);
    assert.match(lines, /Status: not running/);
    assert.match(lines, /CPU main: 67 C/);
    assert.match(lines, /Global max: 67 C/);
  });

  it("explains an unavailable temperature reading", () => {
    const lines = formatStatusReport(baseStatusReport({ reading: null, readingError: "sensor failure" })).join("\n");
    assert.match(lines, /Unavailable: sensor failure/);
  });

  it("lists active violations only", () => {
    const lines = formatStatusReport(
      baseStatusReport({
        violations: [
          { kind: "cpu", label: "CPU", temperature: 95, threshold: 90, count: 2, required: 3, exceeded: true, triggered: false },
          { kind: "gpu", label: "GPU", temperature: null, threshold: 90, count: 0, required: 3, exceeded: false, triggered: false },
        ],
      }),
    ).join("\n");

    assert.match(lines, /CPU: 95 C against 90 C \(2\/3\)/);
    assert.equal(lines.includes("GPU: n\/a"), false);
  });

  it("reports when no threshold is currently exceeded", () => {
    const lines = formatStatusReport(baseStatusReport()).join("\n");
    assert.match(lines, /Active violations\n {2}none/);
  });
});

describe("formatSensorReport", () => {
  it("prints every normalized sensor and marks unavailable values", () => {
    const lines = formatSensorReport({
      cpu: { main: null, max: null, cores: [] },
      gpu: { max: 71, devices: [{ name: "Discrete", vendor: "NVIDIA", temperature: 71 }, { name: "Integrated", vendor: null, temperature: null }] },
      global: { max: 71 },
    }).join("\n");

    assert.match(lines, /main: n\/a/);
    assert.match(lines, /cores: none reported/);
    assert.match(lines, /Discrete \(NVIDIA\): 71 C/);
    assert.match(lines, /Integrated \(unknown vendor\): n\/a/);
    assert.match(lines, /Global max: 71 C/);
  });

  it("warns when nothing is readable", () => {
    const lines = formatSensorReport({
      cpu: { main: null, max: null, cores: [] },
      gpu: { max: null, devices: [] },
      global: { max: null },
    }).join("\n");

    assert.match(lines, /No usable temperature sensor/);
    assert.match(lines, /no GPU device reported/);
  });
});

describe("formatDoctorReport", () => {
  it("prints each check and a summary", () => {
    const lines = formatDoctorReport({
      checks: [
        { name: "Node.js runtime", status: "ok", detail: "v22" },
        { name: "GPU temperature", status: "warn", detail: "unavailable" },
      ],
      summary: { ok: 1, warn: 1, fail: 0 },
      platform: "Linux",
      version: "0.1.0",
    }).join("\n");

    assert.match(lines, /\[ok\] Node\.js runtime: v22/);
    assert.match(lines, /\[warn\] GPU temperature: unavailable/);
    assert.match(lines, /Result: 1 ok, 1 warning\(s\), 0 failure\(s\)/);
  });
});

describe("buildDoctorReport", () => {
  it("fails when no temperature sensor is usable", async () => {
    const adapter = new FakeAdapter({ reading: makeReading({ cpu: null, gpu: null }) });
    const report = await buildDoctorReport({
      config: parseConfig({}).config,
      adapter,
      version: "0.1.0",
      entryPointExists: false,
      stateFileWritable: true,
    });

    assert.ok(report.summary.fail >= 1);
    assert.match(
      report.checks.map((check) => `${check.name}: ${check.detail}`).join("\n"),
      /Usable thermal sensors: no usable temperature sensor/,
    );
  });

  it("reports a healthy dry-run configuration", async () => {
    const adapter = new FakeAdapter();
    const report = await buildDoctorReport({
      config: parseConfig({}).config,
      adapter,
      version: "0.1.0",
      entryPointExists: true,
      stateFileWritable: true,
    });

    assert.equal(report.summary.fail, 0);
    assert.equal(report.checks.some((check) => check.name === "Usable thermal sensors" && check.status === "ok"), true);
  });
});

describe("formatSimulationReport", () => {
  it("states that no system action was executed", async () => {
    const result = await runSimulation({
      policy: makePolicy({ requiredSamples: 2 }),
      cycles: 2,
      cpu: 95,
      gpu: 70,
      logger: silentLogger,
    });

    const lines = formatSimulationReport(result).join("\n");
    assert.match(lines, /SIMULATION MODE/);
    assert.match(lines, /1: CPU 95 C \| GPU 70 C \| Global 95 C \| CPU violation 1\/2/);
    assert.match(lines, /Would shutdown/);
    assert.match(lines, /No system action executed/);
  });

  it("reports when nothing was exceeded", async () => {
    const result = await runSimulation({
      policy: makePolicy(),
      cycles: 1,
      cpu: 40,
      gpu: 40,
      logger: silentLogger,
    });

    const lines = formatSimulationReport(result).join("\n");
    assert.match(lines, /No threshold was exceeded/);
    assert.match(lines, /Would perform no power action/);
    assert.match(lines, /No system action executed/);
  });
});
