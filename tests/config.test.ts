import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConfigError,
  configOverridesToEnvironment,
  isLoopbackHost,
  loadConfig,
  parseConfig,
  resolveStateFilePath,
  toThermalPolicy,
} from "../src/config/config.js";

describe("parseConfig", () => {
  it("applies safe defaults for an empty environment", () => {
    const result = parseConfig({});

    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
    assert.equal(result.config.cpuMax, 90);
    assert.equal(result.config.gpuMax, 90);
    assert.equal(result.config.globalMax, 95);
    assert.equal(result.config.pollIntervalMs, 5000);
    assert.equal(result.config.requiredSamples, 3);
    assert.equal(result.config.action, "shutdown");
    assert.equal(result.config.dryRun, true);
    assert.equal(result.config.api.enabled, false);
    assert.equal(result.config.api.host, "127.0.0.1");
    assert.equal(result.config.api.port, 8787);
    assert.equal(result.config.logLevel, "info");
    assert.equal(result.config.stateFile.endsWith("state.json"), true);
  });

  it("parses a fully specified environment", () => {
    const result = parseConfig({
      THERMORA_CPU_MAX: "85",
      THERMORA_GPU_MAX: "80",
      THERMORA_GLOBAL_MAX: "92",
      THERMORA_POLL_INTERVAL_MS: "1500",
      THERMORA_REQUIRED_SAMPLES: "5",
      THERMORA_ACTION: "restart",
      THERMORA_DRY_RUN: "false",
      THERMORA_API_ENABLED: "yes",
      THERMORA_API_HOST: "localhost",
      THERMORA_API_PORT: "9000",
      THERMORA_LOG_LEVEL: "debug",
      THERMORA_STATE_FILE: "/tmp/thermora-custom.json",
    });

    assert.equal(result.ok, true);
    assert.equal(result.config.cpuMax, 85);
    assert.equal(result.config.gpuMax, 80);
    assert.equal(result.config.globalMax, 92);
    assert.equal(result.config.pollIntervalMs, 1500);
    assert.equal(result.config.requiredSamples, 5);
    assert.equal(result.config.action, "restart");
    assert.equal(result.config.dryRun, false);
    assert.equal(result.config.api.enabled, true);
    assert.equal(result.config.api.host, "localhost");
    assert.equal(result.config.api.port, 9000);
    assert.equal(result.config.logLevel, "debug");
    assert.equal(result.config.stateFile, "/tmp/thermora-custom.json");
  });

  it("reports readable issues for invalid values", () => {
    const result = parseConfig({
      THERMORA_CPU_MAX: "hot",
      THERMORA_GPU_MAX: "10",
      THERMORA_GLOBAL_MAX: "95.5",
      THERMORA_POLL_INTERVAL_MS: "10",
      THERMORA_REQUIRED_SAMPLES: "0",
      THERMORA_ACTION: "reboot",
      THERMORA_DRY_RUN: "maybe",
      THERMORA_API_ENABLED: "sure",
      THERMORA_API_PORT: "70000",
      THERMORA_LOG_LEVEL: "loud",
      THERMORA_API_HOST: "not a host",
    });

    assert.equal(result.ok, false);
    assert.equal(result.issues.length, 11);
    assert.deepEqual(
      result.issues.map((issue) => issue.split(" ")[0]).sort(),
      [
        "THERMORA_CPU_MAX",
        "THERMORA_GPU_MAX",
        "THERMORA_GLOBAL_MAX",
        "THERMORA_POLL_INTERVAL_MS",
        "THERMORA_REQUIRED_SAMPLES",
        "THERMORA_ACTION",
        "THERMORA_DRY_RUN",
        "THERMORA_API_ENABLED",
        "THERMORA_API_PORT",
        "THERMORA_LOG_LEVEL",
        "THERMORA_API_HOST",
      ].sort(),
    );
    const actionIssue = result.issues.find((issue) => issue.startsWith("THERMORA_ACTION")) ?? "";
    assert.match(actionIssue, /must be one of: shutdown, restart/);
    assert.equal(result.config.cpuMax, 90);
    assert.equal(result.config.action, "shutdown");
  });

  it("treats empty values as unset", () => {
    const result = parseConfig({ THERMORA_CPU_MAX: "  ", THERMORA_DRY_RUN: "" });
    assert.equal(result.ok, true);
    assert.equal(result.config.cpuMax, 90);
    assert.equal(result.config.dryRun, true);
  });
});

describe("loadConfig", () => {
  it("throws a ConfigError listing every issue", () => {
    assert.throws(
      () => loadConfig({ THERMORA_CPU_MAX: "abc", THERMORA_ACTION: "explode" }),
      (error: unknown) => {
        assert.equal(error instanceof ConfigError, true);
        const configError = error as ConfigError;
        assert.equal(configError.issues.length, 2);
        return true;
      },
    );
  });
});

describe("resolveStateFilePath", () => {
  it("uses the configured override when present", () => {
    assert.equal(resolveStateFilePath({ THERMORA_STATE_FILE: "/var/lib/thermora/state.json" }), "/var/lib/thermora/state.json");
  });

  it("falls back to a per-machine temporary location", () => {
    assert.equal(resolveStateFilePath({}).endsWith("thermora/state.json"), true);
  });
});

describe("configOverridesToEnvironment", () => {
  it("maps CLI override values onto environment variables", () => {
    const environment = configOverridesToEnvironment({
      cpuMax: "80",
      dryRun: false,
      apiEnabled: true,
      action: "restart",
      requiredSamples: "5",
    });

    assert.equal(environment.THERMORA_CPU_MAX, "80");
    assert.equal(environment.THERMORA_DRY_RUN, "false");
    assert.equal(environment.THERMORA_API_ENABLED, "true");
    assert.equal(environment.THERMORA_ACTION, "restart");
    assert.equal(environment.THERMORA_REQUIRED_SAMPLES, "5");
    assert.equal(environment.THERMORA_GPU_MAX, undefined);
  });

  it("lets explicit overrides win over the environment", () => {
    const merged = { ...{ THERMORA_CPU_MAX: "70" }, ...configOverridesToEnvironment({ cpuMax: "99" }) };
    assert.equal(parseConfig(merged).config.cpuMax, 99);
  });
});

describe("toThermalPolicy", () => {
  it("projects the configuration onto the thermal policy", () => {
    const config = parseConfig({ THERMORA_ACTION: "restart" }).config;
    const policy = toThermalPolicy(config);
    assert.deepEqual(policy.limits, { cpuMax: 90, gpuMax: 90, globalMax: 95, requiredSamples: 3 });
    assert.equal(policy.action, "restart");
  });
});

describe("isLoopbackHost", () => {
  it("recognises loopback hosts", () => {
    assert.equal(isLoopbackHost("127.0.0.1"), true);
    assert.equal(isLoopbackHost("127.0.0.53"), true);
    assert.equal(isLoopbackHost("localhost"), true);
    assert.equal(isLoopbackHost("::1"), true);
    assert.equal(isLoopbackHost("[::1]"), true);
  });

  it("rejects public and wildcard hosts", () => {
    assert.equal(isLoopbackHost("0.0.0.0"), false);
    assert.equal(isLoopbackHost("192.168.1.10"), false);
    assert.equal(isLoopbackHost("example.com"), false);
  });
});
