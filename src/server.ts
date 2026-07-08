/**
 * server.ts
 *
 * Runtime bootstrap. Selects a mode (HTTP + WebSocket handlers) based on
 * `config.mode` and boots it via Bun.serve. Adding a new mode later means
 * adding a case here and a new folder under src/modes/ — nothing else in
 * the gateway needs to change.
 */

import type { GatewayConfig } from "./config";
import { createOfficialProxyMode } from "./modes/official-proxy";

export function resolveMode(config: GatewayConfig) {
  switch (config.mode) {
    case "official-proxy":
      return createOfficialProxyMode(config);
    default: {
      const exhaustiveCheck: never = config.mode;
      throw new Error(`Unknown gateway mode: ${exhaustiveCheck}`);
    }
  }
}

export function startGatewayServer(config: GatewayConfig) {
  const mode = resolveMode(config);

  const server = Bun.serve({
    port: config.port,
    fetch: mode.fetch,
    websocket: mode.websocket,
  });

  console.log(`[gateway] mode="${config.mode}" listening on http://localhost:${config.port}`);
  console.log(`[gateway] proxying HTTP + WebSocket -> ${config.targetOrigin}`);

  return server;
}
