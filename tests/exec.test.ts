import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CommandError,
  commandFailure,
  findExecutable,
  isExecutable,
  pathExists,
  PermissionError,
  runCommand,
  tryCommand,
  type CommandExecution,
} from "../src/utils/exec.js";

const MISSING_BINARY = "thermora-missing-binary-for-tests";

describe("tryCommand", () => {
  it("reports a missing executable instead of throwing", async () => {
    const result = await tryCommand(MISSING_BINARY, []);
    assert.equal(result.ok, false);
    assert.equal(result.missing, true);
    assert.match(result.error ?? "", /was not found/);
  });

  it("captures output and a non-zero exit code", async () => {
    const result = await tryCommand(process.execPath, [
      "-e",
      "process.stdout.write('partial output'); process.exit(3)",
    ]);

    assert.equal(result.ok, false);
    assert.equal(result.code, 3);
    assert.equal(result.stdout, "partial output");
  });

  it("passes arguments literally without a shell", async () => {
    const result = await tryCommand(process.execPath, [
      "-e",
      "process.stdout.write(process.argv[1]);",
      "; rm -rf /",
    ]);

    assert.equal(result.ok, true);
    assert.equal(result.stdout, "; rm -rf /");
  });
});

describe("runCommand", () => {
  it("resolves for a successful command", async () => {
    const result = await runCommand(process.execPath, ["-e", "process.exit(0)"]);
    assert.equal(result.ok, true);
    assert.equal(result.code, 0);
  });

  it("throws a readable error for a failed command", async () => {
    await assert.rejects(
      () => runCommand(process.execPath, ["-e", "process.stderr.write('boom'); process.exit(7)"]),
      (error: unknown) => {
        assert.equal(error instanceof CommandError, true);
        assert.match((error as Error).message, /exited with code 7/);
        assert.match((error as Error).message, /boom/);
        return true;
      },
    );
  });

  it("explains a missing executable", async () => {
    await assert.rejects(
      () => runCommand(MISSING_BINARY, []),
      (error: unknown) => {
        assert.equal(error instanceof CommandError, true);
        assert.match((error as Error).message, /was not found on this system/);
        return true;
      },
    );
  });
});

describe("commandFailure", () => {
  const base: CommandExecution = {
    ok: false,
    code: null,
    stdout: "",
    stderr: "",
    error: "denied",
    permissionDenied: false,
    missing: false,
  };

  it("maps permission failures onto a PermissionError", () => {
    const error = commandFailure("/bin/example", ["--flag"], { ...base, permissionDenied: true });
    assert.equal(error instanceof PermissionError, true);
    assert.match(error.message, /denied permission/);
    assert.match(error.message, /never elevates privileges/);
  });

  it("describes generic failures with the exit code", () => {
    const error = commandFailure("/bin/example", [], { ...base, code: 1, error: "unexpected" });
    assert.equal(error instanceof CommandError, true);
    assert.equal(error instanceof PermissionError, false);
    assert.match(error.message, /exited with code 1: unexpected/);
  });
});

describe("filesystem helpers", () => {
  it("finds executables and ignores missing paths", () => {
    assert.equal(isExecutable(process.execPath), true);
    assert.equal(pathExists(process.execPath), true);
    assert.equal(isExecutable("/definitely/not/here"), false);
    assert.equal(pathExists("/definitely/not/here"), false);
    assert.equal(findExecutable(["/definitely/not/here", process.execPath]), process.execPath);
    assert.equal(findExecutable(["/definitely/not/here"]), null);
  });
});
