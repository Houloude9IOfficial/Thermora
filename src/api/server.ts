import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Logger } from "../types.js";
import type { DaemonState } from "../core/state.js";
import { isLoopbackHost } from "../config/config.js";

export type ApiServerOptions = {
  host: string;
  port: number;
  state: DaemonState;
  logger: Logger;
  version: string;
  platform: string;
};

export type ApiAddress = {
  host: string;
  port: number;
};

export class ApiServer {
  private readonly options: ApiServerOptions;
  private server: Server | null = null;
  private address: ApiAddress | null = null;

  constructor(options: ApiServerOptions) {
    this.options = options;
  }

  get boundAddress(): ApiAddress | null {
    return this.address === null ? null : { ...this.address };
  }

  async start(): Promise<ApiAddress> {
    if (this.server !== null) {
      throw new Error("The Thermora API server is already running");
    }
    const server = createServer((request, response) => this.handleRequest(request, response));
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(this.options.port, this.options.host);
    });

    const bound = server.address();
    if (bound === null || typeof bound === "string") {
      await this.stop();
      throw new Error("The Thermora API server did not bind to a TCP address");
    }

    this.address = { host: bound.address, port: bound.port };
    if (!isLoopbackHost(bound.address)) {
      this.options.logger.warn(
        `The Thermora API is bound to ${bound.address}, which is not a loopback address. Restrict access to this port.`,
      );
    }
    return { ...this.address };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.address = null;
    if (server === null) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    if (request.method !== "GET") {
      this.sendJson(response, 405, { error: "method_not_allowed" });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${this.options.host}`);
    switch (url.pathname) {
      case "/health":
        this.sendJson(response, 200, {
          status: "ok",
          version: this.options.version,
          platform: this.options.platform,
          uptimeSeconds: Math.round(process.uptime()),
        });
        return;
      case "/status":
        this.sendJson(response, 200, this.options.state.snapshot());
        return;
      case "/sensors": {
        const snapshot = this.options.state.snapshot();
        this.sendJson(response, 200, {
          platform: snapshot.platform,
          dryRun: snapshot.dryRun,
          reading: snapshot.reading,
          thresholds: snapshot.thresholds,
          updatedAt: snapshot.updatedAt,
        });
        return;
      }
      default:
        this.sendJson(response, 404, { error: "not_found", endpoints: ["/health", "/status", "/sensors"] });
    }
  }

  private sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
    const body = `${JSON.stringify(payload, null, 2)}\n`;
    response.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    response.end(body);
  }
}
