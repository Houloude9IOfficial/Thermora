import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { Options } from "../src/cli/args.js";
import { runCliWithEnvironment } from "../src/cli/cli.js";
import { createCapturedIo } from "../src/cli/io.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type CliRun = {
  exitCode: number;
  output: string;
  errors: string;
};

async function run(args: readonly string[], environment: Record<string, string | undefined> = {}): Promise<CliRun> {
  const io = createCapturedIo();
  const exitCode = await runCliWithEnvironment({ argv: args, io, environment, projectRoot });
  return { exitCode, output: io.output.join("\n"), errors: io.errors.join("\n") };
}

describe("Options.parse", () => {
  it("separates positionals from options", () => {
    const { options, positionals } = Options.parse(["simulate", "--cpu", "95", "--json"]);
    assert.deepEqual(positionals, ["simulate"]);
    assert.equal(options.value("cpu"), "95");
    assert.equal(options.boolean("json"), true);
  });

  it("supports --key=value, --no- prefixes and short flags", () => {
    const { options, positionals } = Options.parse(["--interval=2500", "--no-dry-run", "-h", "start"]);
    assert.equal(options.value("interval"), "2500");
    assert.equal(options.boolean("no-dry-run"), true);
    assert.equal(options.has("dry-run"), false);
    assert.equal(options.has("help"), true);
    assert.deepEqual(positionals, ["start"]);
  });

  it("keeps bare flags boolean and never consumes the next flag as a value", () => {
    const { options } = Options.parse(["--api", "--interval", "1000"]);
    assert.equal(options.boolean("api"), true);
    assert.equal(options.value("interval"), "1000");
  });

  it("throws a usage error when a value is missing", () => {
    const { options } = Options.parse(["start", "--interval"]);
    assert.throws(() => options.value("interval"), /--interval requires a value/);
  });

  it("treats everything after -- as positional", () => {
    const { options, positionals } = Options.parse(["--", "--not-an-option"]);
    assert.deepEqual(positionals, ["--not-an-option"]);
    assert.equal(options.has("not-an-option"), false);
  });
});

describe("runCliWithEnvironment", () => {
  it("prints help for the default command", async () => {
    const result = await run([], {});
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /Usage: thermora <command> \[options\]/);
    assert.match(result.output, /simulate/);
  });

  it("prints the version", async () => {
    const result = await run(["version"], {});
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /^Thermora v\d+\.\d+\.\d+$/);
  });

  it("rejects unknown commands", async () => {
    const result = await run(["melt"], {});
    assert.equal(result.exitCode, 2);
    assert.match(result.errors, /Unknown command: melt/);
  });

  it("reports invalid configuration with readable issues", async () => {
    const result = await run(["status"], { THERMORA_CPU_MAX: "boiling", THERMORA_ACTION: "explode" });
    assert.equal(result.exitCode, 2);
    assert.match(result.errors, /THERMORA_CPU_MAX must be an integer/);
    assert.match(result.errors, /THERMORA_ACTION must be one of: shutdown, restart/);
  });

  it("applies CLI overrides on top of the environment", async () => {
    const result = await run(["status", "--cpu-max", "75", "--no-dry-run", "--json"], { THERMORA_CPU_MAX: "80" });
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /"mode": "ENFORCING"/);
    assert.match(result.output, /"cpu": 75/);
  });

  it("prints sensors for the current platform", async () => {
    const result = await run(["sensors", "--json"], {});
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /"reading": \{/);
  });

  it("runs a simulation that never executes a system action", async () => {
    const result = await run(["simulate", "--cpu", "95"], { THERMORA_DRY_RUN: "false" });

    assert.equal(result.exitCode, 0);
    assert.match(result.output, /SIMULATION MODE/);
    assert.match(result.output, /Would shutdown/);
    assert.match(result.output, /No system action executed/);
    assert.equal(result.output.includes("A system action was executed"), false);
  });

  it("simulates GPU limits and global limits together", async () => {
    const result = await run(["simulate", "--cpu", "40", "--gpu", "98", "--cycles", "3"], {});
    assert.equal(result.exitCode, 0);
    assert.match(result.output, /GPU violation/);
    assert.match(result.output, /No system action executed/);
  });

  it("requires at least one simulated temperature", async () => {
    const result = await run(["simulate"], {});
    assert.equal(result.exitCode, 2);
    assert.match(result.errors, /Provide at least one simulated temperature/);
  });

  it("rejects nonsensical simulated temperatures", async () => {
    const result = await run(["simulate", "--cpu", "warm"], {});
    assert.equal(result.exitCode, 2);
    assert.match(result.errors, /--cpu expects a numeric temperature/);
  });

  it("prints a doctor report", async () => {
    const result = await run(["doctor"], { THERMORA_API_ENABLED: "true" });
    assert.match(result.output, /Thermora doctor/);
    assert.match(result.output, /Node\.js runtime/);
    assert.match(result.output, /Result: \d+ ok, \d+ warning\(s\), \d+ failure\(s\)/);
  });

  it("accepts json output for doctor", async () => {
    const result = await run(["doctor", "--json"], {});
    const parsed: unknown = JSON.parse(result.output);
    assert.equal(typeof parsed, "object");
    assert.equal(Array.isArray((parsed as { checks: unknown[] }).checks), true);
  });
});
