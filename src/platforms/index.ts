import type { PlatformAdapter, PlatformId } from "../types.js";
import { createLinuxAdapter } from "./linux/index.js";
import { createMacosAdapter } from "./macos/index.js";
import { createWindowsAdapter } from "./windows/index.js";

export const SUPPORTED_PLATFORMS: readonly PlatformId[] = ["macos", "windows", "linux"];

export const NODE_PLATFORM_MAP: Record<string, PlatformId> = {
  darwin: "macos",
  win32: "windows",
  linux: "linux",
};

export class UnsupportedPlatformError extends Error {
  readonly platform: string;

  constructor(platform: string) {
    super(
      `Thermora does not support the "${platform}" platform. Supported platforms are: ${SUPPORTED_PLATFORMS.join(", ")}.`,
    );
    this.name = "UnsupportedPlatformError";
    this.platform = platform;
  }
}

export function platformIdFor(nodePlatform: string = process.platform): PlatformId {
  const platformId = NODE_PLATFORM_MAP[nodePlatform];
  if (platformId === undefined) throw new UnsupportedPlatformError(nodePlatform);
  return platformId;
}

export function resolvePlatformAdapter(nodePlatform: string = process.platform): PlatformAdapter {
  switch (platformIdFor(nodePlatform)) {
    case "macos":
      return createMacosAdapter();
    case "windows":
      return createWindowsAdapter();
    case "linux":
      return createLinuxAdapter();
  }
}
