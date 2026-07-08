/**
 * official-proxy mode entry point.
 *
 * Combines the HTTP handler (http.ts) and the WebSocket tunnel
 * (websocket.ts) into a single mode object shaped for Bun.serve, which
 * requires `fetch` and `websocket` on the same options object. The
 * incoming request is routed to the WS tunnel when it's an upgrade
 * request, otherwise to the regular HTTP proxy handler.
 */

import type { Server } from "bun";
import type { GatewayConfig } from "../../config";
import { createHttpProxyHandler } from "./http";
import { createWebSocketProxy, type TunnelSocketData } from "./websocket";

export function createOfficialProxyMode(config: GatewayConfig) {
  const handleHttp = createHttpProxyHandler(config);
  const wsProxy = createWebSocketProxy(config);

  return {
    fetch(request: Request, server: Server<TunnelSocketData>): Response | undefined | Promise<Response> {
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
