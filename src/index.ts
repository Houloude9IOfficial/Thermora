#!/usr/bin/env node
import { runCli } from "./cli/cli.js";
import { describeError } from "./utils/format.js";

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`Thermora failed: ${describeError(error)}\n`);
  process.exitCode = 1;
}
