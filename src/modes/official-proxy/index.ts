/**
 * official-proxy mode entry point.
 *
 * Combines three request paths into a single mode object shaped for
 * Bun.serve (which requires `fetch` and `websocket` on the same options
 * object):
 *
 *  1. /__telemetry/*  -- the local dashboard's own API + UI. Handled
 *     entirely by the gateway, never forwarded upstream.
 *  2. WebSocket upgrades -- tunneled to the proxied application.
 *  3. everything else -- the regular HTTP/HTML proxy handler.
 *
 * Order matters: telemetry routes are checked first so they can never be
 * shadowed by an upstream path of the same name.
 */

import type { Server } from "bun";
import type { GatewayConfig } from "../../config";
import { createTelemetryApiHandler } from "../../telemetry/api";
import { createHttpProxyHandler } from "./http";
import { createWebSocketProxy, type TunnelSocketData } from "./websocket";

export function createOfficialProxyMode(config: GatewayConfig) {
  const handleTelemetry = createTelemetryApiHandler();
  const handleHttp = createHttpProxyHandler(config);
  const wsProxy = createWebSocketProxy(config);

  return {
    async fetch(request: Request, server: Server<TunnelSocketData>): Promise<Response | undefined> {
      const url = new URL(request.url);

      const telemetryResponse = await handleTelemetry(request, url.pathname);
      if (telemetryResponse) {
        return telemetryResponse;
      }

      const upgradeResult = wsProxy.tryUpgrade(request, server);
      if (upgradeResult === true) {
        // Bun has taken over the connection; no HTTP response to return.
        return undefined;
      }
      if (upgradeResult instanceof Response) {
        return upgradeResult;
      }

      return handleHttp(request);
    },
    websocket: wsProxy.handlers,
  };
}
