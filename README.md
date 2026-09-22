# Thermora

Cross-platform thermal protection daemon for Windows, Linux and macOS.

Thermora continuously reads the CPU and GPU temperatures that the operating system
makes available, compares them against configurable limits, and can request a clean
shutdown or restart when a limit is exceeded for several consecutive samples.

```
Thermora v0.1.0
Platform: macOS (macos)
Mode: DRY RUN

Configuration
  Action: shutdown
  Poll interval: 5000 ms
  Required samples: 3
  CPU limit: 90 C
  GPU limit: 90 C
  Global limit: 95 C
  API: disabled

Daemon
  Status: not running

Temperatures
  CPU main: 67 C
  CPU max: 71 C
  CPU cores: 10
  GPU max: 64 C
  Global max: 71 C

Active violations
  none
```

## Safety implications

> **Thermora can shut down or restart your computer.**
>
> A real power action is destructive: unsaved work is lost, running services are
> stopped and remote sessions are terminated. Thermora never elevates privileges on
> its own and never hides what it is about to do, but it will perform exactly the
> action you configured once a limit is exceeded for the configured number of
> consecutive samples.

Safety features that are always active:

- **Dry run is the default.** `THERMORA_DRY_RUN=true` reads real temperatures, runs
  the real evaluation, keeps the real violation counters and acquires the real action
  lock, but never executes a shutdown or restart. Enable enforcing mode only when you
  mean it (`THERMORA_DRY_RUN=false`).
- **Simulation can never act.** `thermora simulate` replaces the sensor source and the
  destructive boundary only. It uses the real normalization, evaluator, violation
  counters, action lock and decision logic, and it cannot execute a power action under
  any configuration.
- **Consecutive samples are required.** A single spike never triggers an action.
- **One action per incident.** The global action lock and incident tracking prevent a
  second threshold from starting another action while an action is in progress or
  while the same thermal incident is still ongoing.
- **The API is read-only.** There are no restart or shutdown endpoints in V1.

## Supported operating systems

| Operating system | Temperature source | Power actions | Startup integration |
| --- | --- | --- | --- |
| macOS | `systeminformation` (SMC / thermal APIs) | `osascript` driving System Events | launchd launch agent (`~/Library/LaunchAgents/com.thermora.daemon.plist`) |
| Windows | `systeminformation` (WMI, vendor drivers) | `shutdown.exe` (`/s`, `/r`) | Task Scheduler logon task (`Thermora`) |
| Linux | `systeminformation` plus `/sys/class/thermal` thermal zones | `systemctl poweroff` / `reboot`, with `shutdown` fallback | systemd user service (`~/.config/systemd/user/thermora.service`) |

## Supported temperature categories

Thermora normalizes all readings into its own model before evaluation:

| Category | Meaning |
| --- | --- |
| CPU main | The primary CPU temperature reported by the operating system |
| CPU max | The highest usable CPU temperature, derived by Thermora |
| CPU cores | Individual core or per-sensor temperatures, where available |
| GPU devices | Every detected GPU with its own temperature, name and vendor |
| GPU max | The highest usable GPU temperature across all devices |
| Global max | The highest usable reading anywhere, calculated by Thermora |

A sensor that cannot be read is reported as `null` and is **never** treated as `0`.
Readings outside the physically plausible range (`0 C < t <= 150 C`) are rejected, which
also discards the `-1` sentinel that `systeminformation` uses for unavailable sensors.

## Hardware and driver limitations

Available readings depend entirely on the operating system, the hardware, the firmware,
the drivers and the permissions of the account running Thermora. Thermora does not claim
that a specific machine will report any particular sensor.

- **macOS.** On Apple Silicon there is currently **no** first-party way to read a CPU or
  GPU temperature from user space: macOS exposes none to user space, and while
  `/usr/bin/powermetrics` requires root for every sampler, the `smc` sampler that used to
  print die temperatures has been removed in current macOS versions. Elevating privileges
  does not change this, so Thermora reports `n/a` on such machines rather than inventing a
  value — unless you opt in to an external sensor provider. Intel Macs read temperatures
  through the SMC, sometimes only with elevated privileges. Power actions always use
  `osascript` and System Events.
- **Windows.** CPU packages often need a monitoring driver (for example OpenHardwareMonitor)
  or firmware support before WMI exposes a temperature. GPU temperatures depend on the
  vendor driver; NVIDIA readings typically come from `nvidia-smi`.
- **Linux.** Kernel modules such as `coretemp`, `k10temp` or `zenpower` are frequently
  required before `/sys/class/thermal` or hwmon expose anything. Container guests and
  virtual machines often expose nothing at all.
- When no usable sensor is readable, Thermora does not pretend to be protecting the
  machine: it logs a prominent error at startup and warns once while monitoring.
- When only one category is readable, protection continues for the sensors that work.
  CPU protection stays active without a GPU sensor, and GPU protection stays active
  without a CPU sensor.

## Requirements

- Node.js 22.9 or newer
- npm
- Linux: systemd for startup integration, `systemctl` or `shutdown` for power actions
- macOS: `launchctl` and `osascript`
- Windows: Task Scheduler (`schtasks.exe`) and `shutdown.exe`

## Installation

```bash
git clone <repository-url> thermora
cd thermora
npm install
npm run build
npm test
```

Run it in the foreground:

```bash
node dist/index.js start --dry-run
```

Install it as a CLI on your machine:

```bash
npm link
thermora doctor
```

## Development

```bash
npm run dev        # tsx watch mode, forced dry run, never performs a power action
npm run dev:once   # single tsx run with forced dry run
npm run typecheck  # strict TypeScript checking without emitting
npm test           # Node's built-in test runner through tsx
npm run test:watch # tests in watch mode
npm run simulate -- --cpu 95
```

`npm run dev` always passes `--dry-run`, so development cannot accidentally restart or
shut down the developer's machine.

## Building

```bash
npm run build   # clean + compile TypeScript to dist
npm start       # run the compiled build
npm run clean   # remove dist
```

The production entry point is `dist/index.js` and the package exposes it as the
`thermora` binary. Startup integrations run the compiled output, never `tsx`.

## Configuration

Configuration comes from environment variables. Thermora loads `.env` from the project
root at startup (values already present in the environment take precedence), and the
installed service also uses that file through Node's `--env-file-if-exists` flag.

Copy `.env.example` to `.env` and adjust it:

```bash
cp .env.example .env
```

| Variable | Default | Description |
| --- | --- | --- |
| `THERMORA_CPU_MAX` | `90` | CPU maximum temperature limit in Celsius (integer, 30-150) |
| `THERMORA_GPU_MAX` | `90` | GPU maximum temperature limit in Celsius (integer, 30-150) |
| `THERMORA_GLOBAL_MAX` | `95` | Global maximum temperature limit in Celsius (integer, 30-150) |
| `THERMORA_POLL_INTERVAL_MS` | `5000` | Poll interval in milliseconds (integer, 500-3600000) |
| `THERMORA_REQUIRED_SAMPLES` | `3` | Consecutive violating samples required before acting (integer, 1-1000) |
| `THERMORA_ACTION` | `shutdown` | Action to perform: `shutdown` or `restart` |
| `THERMORA_DRY_RUN` | `true` | When `true`, no real power action is ever executed |
| `THERMORA_API_ENABLED` | `false` | Enable the optional local read-only API |
| `THERMORA_API_HOST` | `127.0.0.1` | API bind host |
| `THERMORA_API_PORT` | `8787` | API bind port (integer, 1-65535) |
| `THERMORA_LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `THERMORA_STATE_FILE` | system temporary directory | Where the daemon writes its status snapshot |
| `THERMORA_MACOS_SENSOR_COMMAND` | empty (disabled) | macOS only: external CLI used to supply temperatures when macOS exposes none |
| `THERMORA_MACOS_SENSOR_ARGS` | empty | macOS only: whitespace separated arguments for that command |

Every value is validated. Invalid values produce a readable startup error listing each
problem, for example:

```
Invalid Thermora configuration for start:
  - THERMORA_CPU_MAX must be an integer between 30 and 150 (received "hot")
  - THERMORA_ACTION must be one of: shutdown, restart (received "reboot")
```

Command line flags override the environment for a single run: `--dry-run`,
`--no-dry-run`, `--cpu-max`, `--gpu-max`, `--global-max`, `--interval`, `--samples`,
`--action`, `--api`, `--no-api`, `--api-host`, `--api-port`, `--log-level`,
`--state-file` and `--json`.

## Consecutive threshold protection

Each threshold keeps its own counter. A reading must exceed its limit for the configured
number of consecutive samples before Thermora acts, and the counter resets as soon as the
reading falls back to or below the limit:

```
91 C -> CPU violation 1/3
92 C -> CPU violation 2/3
93 C -> CPU violation 3/3 -> ACTION
70 C -> counter reset
```

CPU, GPU and global counters are tracked independently. Once an action has been decided,
Thermora enters the `action-in-progress` state, no other threshold can start a second
action, and no further evaluation happens until the daemon stops.

## External sensor provider (macOS, opt in)

Because macOS exposes no first-party user-space CPU or GPU temperature on Apple Silicon,
Thermora can be pointed at an external CLI that reads one for you. The provider is
**disabled by default** and is never required on Linux or Windows.

```bash
# smctemp
THERMORA_MACOS_SENSOR_COMMAND=/usr/local/bin/smctemp \
THERMORA_MACOS_SENSOR_ARGS="-c" \
node dist/index.js sensors

# istats
THERMORA_MACOS_SENSOR_COMMAND=istats THERMORA_MACOS_SENSOR_ARGS="scan" node dist/index.js doctor

# osx-cpu-temp
THERMORA_MACOS_SENSOR_COMMAND=/opt/homebrew/bin/osx-cpu-temp node dist/index.js start
```

How it behaves:

- The adapter runs the configured command directly with `execFile` and no shell. Arguments
  are whitespace separated, so put any quoting inside the command you configure.
- **First-party readings always win.** The provider only fills categories that
  `systeminformation` could not read: if the SMC already reports CPU temperatures, that
  GPU reading is ignored; if the CPU is unknown, the provider supplies it.
- Output is parsed tolerantly. Labels containing `cpu`, `core`, `die`, `package`, `soc`,
  `cluster`, `efficiency` or `performance` count as CPU readings, labels containing `gpu`,
  `graphics`, `radeon`, `nvidia`, `geforce`, `metal` or `video` count as GPU devices, and a
  bare value such as `72.3°C` counts as the CPU temperature. Values must carry a `C`, `°C`
  or `celsius` unit, or be the only number on their own line.
- Anything outside `0 < t <= 150 C` is discarded, and a provider that fails is retried at
  most once every five minutes so a broken helper cannot flood the machine with processes.
- `thermora doctor` reports the provider explicitly: `not configured`, the readings it
  supplied, or the exact failure such as `was not found` or
  `produced no recognizable temperature (first line: ...)`.
- Thermora never elevates privileges for the provider, and the command is only ever the
  one you configured. Run the helper as the same user that runs Thermora; if it needs root,
  install it as a privileged helper of your choosing.

The provider is macOS-only and lives entirely inside `src/platforms/macos/`, so the
Thermora core and the other platform adapters are unaffected by it.

## Dry run

```bash
THERMORA_DRY_RUN=true node dist/index.js start
```

```
[WARN] CPU at 93 C exceeds the 90 C limit (violation 1/3)
[ERROR] CRITICAL: CPU reached 93 C (limit 90 C)
[WARN] [DRY RUN] Would shutdown system (CPU reached 93 C (limit 90 C))
```

Dry run reads real sensors, evaluates real limits, maintains real counters and acquires
the action lock. It only replaces the final destructive step, and it releases the lock
afterwards so monitoring continues.

## Simulation

```bash
npm run simulate -- --cpu 95
npm run simulate -- --gpu 98
npm run simulate -- --cpu 95 --gpu 97
node dist/index.js simulate --cpu 120 --cycles 5 --json
```

```
SIMULATION MODE

Cycles
  1: CPU 95 C | GPU 70 C | Global 95 C | CPU violation 1/3
  2: CPU 95 C | GPU 70 C | Global 95 C | CPU violation 2/3
  3: CPU 95 C | GPU 70 C | Global 95 C | CPU violation 3/3

CPU reached 95 C (limit 90 C)

Would shutdown
No system action executed
```

Simulation never touches the platform power integration and cannot execute a real action,
regardless of `THERMORA_DRY_RUN` or `THERMORA_ACTION`.

## CLI

| Command | Purpose |
| --- | --- |
| `thermora start` | Start monitoring in the foreground |
| `thermora status` | Configuration, platform, daemon status, thresholds and current temperatures |
| `thermora sensors` | Print the normalized temperature sensors available right now |
| `thermora simulate` | Run a safe simulation through the real evaluator |
| `thermora setup` | Install Thermora so it starts automatically with the operating system |
| `thermora uninstall` | Remove only the startup integration created by Thermora |
| `thermora doctor` | Check platform support, sensors, native tools, permissions and startup integration |
| `thermora help`, `thermora version` | Usage and version information |

`status`, `sensors` and `doctor` accept `--json` for machine readable output.

Exit codes: `0` success, `1` runtime failure (including doctor failures), `2` usage or
configuration error, `3` unsupported platform.

## Optional local API

```bash
THERMORA_API_ENABLED=true THERMORA_API_HOST=127.0.0.1 THERMORA_API_PORT=8787 \
  node dist/index.js start
```

| Endpoint | Description |
| --- | --- |
| `GET /health` | `{"status":"ok","version":...,"platform":...,"uptimeSeconds":...}` |
| `GET /status` | Full daemon snapshot: configuration, phase, counters, last action |
| `GET /sensors` | Current normalized reading and configured thresholds |

The API is disabled by default, binds to `127.0.0.1`, reuses the daemon's existing state
instead of polling sensors again, only answers `GET`, and exposes no restart or shutdown
endpoint. `doctor` warns when the configured host is not a loopback address.

## Startup and daemon setup

```bash
thermora setup
```

Setup builds the production output when `dist/index.js` is missing, and then installs the
platform integration that runs `node dist/index.js start`:

- **macOS** writes a launch agent to `~/Library/LaunchAgents/com.thermora.daemon.plist`
  and loads it with `launchctl`.
- **Windows** registers the `Thermora` task through `schtasks.exe` at logon, preferring
  the highest run level and falling back to a limited one.
- **Linux** writes `~/.config/systemd/user/thermora.service` and runs
  `systemctl --user enable --now thermora.service`.

Only Thermora related configuration is written or removed. If Thermora is still in dry
run mode, `setup` says so explicitly: the installed service will not perform real power
actions until `THERMORA_DRY_RUN=false` is set and setup is run again.

## Uninstall

```bash
thermora uninstall
```

This unloads and deletes only the Thermora startup integration
(plist, scheduled task or systemd user service). It never deletes the repository, the
build output or the configuration.

## Permissions

Thermora never silently elevates privileges and never runs a command through a shell.
When a native command reports `EACCES`/`EPERM`, Thermora reports a permission error that
explains an elevated shell may be required.

- **macOS.** Shutting down through System Events can require Automation permission for
  the process running Thermora.
- **Windows.** `shutdown.exe` needs the shutdown privilege, which some hardened
  configurations withhold from service accounts.
- **Linux.** `systemctl poweroff` and `reboot` are refused for unprivileged users unless
  polkit allows them or Thermora runs under a service manager. A systemd *user* service
  only runs while the user has a session unless lingering is enabled
  (`loginctl enable-linger <user>`), which `doctor` mentions.

## Testing

```bash
npm test
```

The suite runs on Node's built-in test runner and covers normal operation, CPU / GPU /
global thresholds, consecutive sample requirements, counter resets, the global action
lock, simultaneous threshold violations, missing sensors, invalid sensor values,
multiple GPU maximum calculation, global maximum calculation, dry-run behaviour,
simulation safety, environment parsing, invalid configuration, the platform resolver,
unsupported platforms, startup command generation and safe process execution.

No test ever performs a real shutdown or restart: the power layer is an injectable
`PowerExecutor`, and tests use fakes.

## Project architecture

```
                 Thermora Core
                      |
                PlatformAdapter
                      |
          +-----------+-----------+
          |           |           |
        macOS      Windows       Linux
```

```
src/
├── index.ts                  CLI entry point (bin)
├── cli/
│   ├── cli.ts                argument parsing, configuration loading, dispatch
│   ├── args.ts               dependency-free option parsing
│   ├── overrides.ts          flags -> configuration overrides
│   ├── io.ts                 output abstraction
│   └── commands/             start, status, sensors, simulate, setup, uninstall, doctor, help
├── core/
│   ├── evaluator.ts          pure threshold evaluation and consecutive counters
│   ├── engine.ts             counters + incident tracking + action lock + executor
│   ├── monitor.ts            non-overlapping polling loop
│   ├── power.ts              dry-run and adapter-backed power executors
│   ├── lock.ts               single-daemon pid lock
│   ├── state.ts              action lock and daemon state container
│   └── stateFile.ts          state snapshot persistence
├── config/
│   ├── config.ts             validation, defaults and overrides
│   └── env.ts                .env loading
├── api/server.ts             optional read-only local HTTP API
├── platforms/
│   ├── index.ts              the single platform resolver
│   ├── macos/                tempWatch.ts, power.ts, startup.ts, index.ts
│   ├── windows/              tempWatch.ts, power.ts, startup.ts, index.ts
│   └── linux/                tempWatch.ts, power.ts, startup.ts, index.ts
├── services/
│   ├── daemon.ts             lifecycle: lock, monitor, API, signals, state
│   ├── simulation.ts         simulation through the real evaluator
│   └── report.ts             status, sensors, doctor and simulation reports
├── utils/                    logging, process execution, normalization, formatting
└── types.ts                  shared domain model
```

The core knows nothing about how an operating system collects temperatures, restarts,
shuts down or installs startup entries. Everything platform specific lives behind one
interface:

```ts
interface PlatformAdapter {
  readonly id: "macos" | "windows" | "linux";
  readonly name: string;
  readonly capabilities: PlatformCapabilities;
  getTemperatures(): Promise<TemperatureReading>;
  restart(): Promise<void>;
  shutdown(): Promise<void>;
  installStartup(context: StartupContext): Promise<StartupInstallation>;
  uninstallStartup(): Promise<StartupRemoval>;
  runDiagnostics(): Promise<DiagnosticCheck[]>;
}
```

Every reading is normalized into Thermora's own `TemperatureReading` type before it
reaches the evaluator, so raw `systeminformation` responses never leak into the core.

`process.platform` is translated in exactly one place, `src/platforms/index.ts`
(`darwin -> macOS`, `win32 -> Windows`, `linux -> Linux`). After resolution, the whole
application works against the adapter. Replacing a sensor library, a native command, a
service installer or the entire temperature collection mechanism for one operating
system means implementing this interface inside that platform directory, with no change
to the monitoring core.

## Troubleshooting

- `sensors` shows `n/a` for everything: the operating system, firmware, drivers or
  permissions do not expose any temperature to user space. Run `thermora doctor` for the
  platform specific explanation.
- `doctor` reports a missing production build: run `npm run build` or just `thermora setup`,
  which builds when needed.
- Power actions fail with a permission error: run the command from an elevated shell or
  grant the required privilege. Thermora will not do this for you.
- A Thermora monitor is already running: stop it before starting another one. The pid
  lock lives next to the state file and is released on `SIGINT`/`SIGTERM`.

## License

MIT. See [LICENSE](LICENSE).
