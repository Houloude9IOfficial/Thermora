import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NODE_PLATFORM_MAP, platformIdFor, resolvePlatformAdapter, SUPPORTED_PLATFORMS, UnsupportedPlatformError } from "../src/platforms/index.js";
import { buildLaunchAgent, MACOS_SERVICE_NAME, startupTargetPath as macosTargetPath } from "../src/platforms/macos/startup.js";
import { buildServiceUnit, LINUX_SERVICE_NAME, startupTargetPath as linuxTargetPath } from "../src/platforms/linux/startup.js";
import { buildTaskCommand, WINDOWS_TASK_NAME } from "../src/platforms/windows/startup.js";
import type { PlatformAdapter, StartupContext } from "../src/types.js";

const startupContext: StartupContext = {
  projectRoot: "/opt/thermora",
  command: "/usr/bin/node",
  args: ["/opt/thermora/dist/index.js", "start"],
  logDirectory: "/opt/thermora/logs",
};

function assertAdapterContract(adapter: PlatformAdapter, id: string, name: string): void {
  assert.equal(adapter.id, id);
  assert.equal(adapter.name, name);
  assert.equal(typeof adapter.getTemperatures, "function");
  assert.equal(typeof adapter.restart, "function");
  assert.equal(typeof adapter.shutdown, "function");
  assert.equal(typeof adapter.installStartup, "function");
  assert.equal(typeof adapter.uninstallStartup, "function");
  assert.equal(typeof adapter.runDiagnostics, "function");
  assert.equal(typeof adapter.capabilities.shutdown, "boolean");
  assert.equal(typeof adapter.capabilities.restart, "boolean");
  assert.equal(typeof adapter.capabilities.startup, "boolean");
}

describe("platformIdFor", () => {
  it("maps node platform identifiers onto Thermora platforms", () => {
    assert.equal(platformIdFor("darwin"), "macos");
    assert.equal(platformIdFor("win32"), "windows");
    assert.equal(platformIdFor("linux"), "linux");
    assert.deepEqual(NODE_PLATFORM_MAP, { darwin: "macos", win32: "windows", linux: "linux" });
  });

  it("rejects unsupported platforms with a readable error", () => {
    assert.throws(
      () => platformIdFor("freebsd"),
      (error: unknown) => {
        assert.equal(error instanceof UnsupportedPlatformError, true);
        assert.match((error as Error).message, /does not support the "freebsd" platform/);
        return true;
      },
    );
  });
});

describe("resolvePlatformAdapter", () => {
  it("returns the macOS adapter for darwin", () => {
    assertAdapterContract(resolvePlatformAdapter("darwin"), "macos", "macOS");
  });

  it("returns the Windows adapter for win32", () => {
    assertAdapterContract(resolvePlatformAdapter("win32"), "windows", "Windows");
  });

  it("returns the Linux adapter for linux", () => {
    assertAdapterContract(resolvePlatformAdapter("linux"), "linux", "Linux");
  });

  it("exposes exactly three supported platforms", () => {
    assert.deepEqual([...SUPPORTED_PLATFORMS], ["macos", "windows", "linux"]);
  });

  it("throws for an unsupported platform instead of guessing", () => {
    assert.throws(() => resolvePlatformAdapter("sunos"), UnsupportedPlatformError);
  });
});

describe("startup integration definitions", () => {
  it("targets a launch agent plist on macOS", () => {
    assert.equal(MACOS_SERVICE_NAME, "com.thermora.daemon");
    const target = macosTargetPath();
    assert.equal(target.endsWith(`Library/LaunchAgents/${MACOS_SERVICE_NAME}.plist`), true);

    const plist = buildLaunchAgent(startupContext);
    assert.match(plist, /<key>Label<\/key>/);
    assert.match(plist, /<string>\/usr\/bin\/node<\/string>/);
    assert.match(plist, /<string>\/opt\/thermora\/dist\/index\.js<\/string>/);
    assert.match(plist, /<string>start<\/string>/);
    assert.match(plist, /<key>RunAtLoad<\/key>/);
  });

  it("targets a systemd user service on Linux", () => {
    assert.equal(LINUX_SERVICE_NAME, "thermora.service");
    const target = linuxTargetPath();
    assert.equal(target.endsWith(`.config/systemd/user/${LINUX_SERVICE_NAME}`), true);

    const unit = buildServiceUnit(startupContext);
    assert.match(unit, /^\[Unit\]/);
    assert.match(unit, /ExecStart=\/usr\/bin\/node \/opt\/thermora\/dist\/index\.js start/);
    assert.match(unit, /WantedBy=default\.target/);
    assert.match(unit, /Restart=on-failure/);
  });

  it("targets a scheduled task on Windows", () => {
    assert.equal(WINDOWS_TASK_NAME, "Thermora");
    const taskCommand = buildTaskCommand(startupContext);
    assert.match(taskCommand, /^"\/usr\/bin\/node" "\/opt\/thermora\/dist\/index\.js" "start"$/);
  });

  it("never generates a command that runs the TypeScript sources", () => {
    assert.equal(buildLaunchAgent(startupContext).includes("tsx"), false);
    assert.equal(buildServiceUnit(startupContext).includes("tsx"), false);
    assert.equal(buildTaskCommand(startupContext).includes("tsx"), false);
  });
});
