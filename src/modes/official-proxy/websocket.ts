/**
 * websocket.ts (official-proxy mode)
 *
 * Raw, bidirectional WebSocket tunnel between the local client and
 * `config.targetOrigin`. This is transport-level plumbing only: frames
 * are relayed byte-for-byte, never parsed or modified. Reading/acting on
 * the WebSocket payloads is explicitly out of scope for this
 * infrastructure phase and will be layered on top later.
 *
 * Every failure path closes sockets defensively but never throws back
 * into the Bun.serve event loop — a broken upstream connection should
 * drop that one tunnel, not the gateway process.
 */

import type { Server, ServerWebSocket } from "bun";
import type { GatewayConfig } from "../../config";

export interface TunnelSocketData {
  targetPath: string;
}

function toUpstreamWebSocketUrl(origin: string, pathAndQuery: string): string {
  const url = new URL(pathAndQuery, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function isUpgradeRequest(request: Request): boolean {
  return (request.headers.get("upgrade") ?? "").toLowerCase() === "websocket";
}

/**
 * Attempts to upgrade `request` into a tunneled WebSocket connection.
 * Returns `true` if Bun took over the connection (caller must return
 * `undefined` from its fetch handler), `false` if this wasn't an upgrade
 * request at all, or a `Response` describing why the upgrade failed.
 */
function tryUpgrade(request: Request, server: Server<TunnelSocketData>): boolean | Response {
  if (!isUpgradeRequest(request)) {
    return false;
  }

  const url = new URL(request.url);
  const data: TunnelSocketData = { targetPath: url.pathname + url.search };

  const upgraded = server.upgrade(request, { data });
  if (upgraded) {
    return true;
  }
  return new Response("WebSocket upgrade failed", { status: 400 });
}

export function createWebSocketProxy(config: GatewayConfig) {
  const upstreamSockets = new WeakMap<ServerWebSocket<TunnelSocketData>, WebSocket>();
  const pendingOutbound = new WeakMap<ServerWebSocket<TunnelSocketData>, Array<string | Uint8Array>>();

  function safeClose(socket: { close: (code?: number, reason?: string) => void }, code?: number, reason?: string) {
    try {
      socket.close(code, reason);
    } catch (error) {
      console.error("[gateway] error while closing websocket:", error);
    }
  }

  return {
    isUpgradeRequest,
    tryUpgrade,

    handlers: {
      open(client: ServerWebSocket<TunnelSocketData>) {
        try {
          const upstreamUrl = toUpstreamWebSocketUrl(config.targetOrigin, client.data.targetPath);
          const upstream = new WebSocket(upstreamUrl);
          upstream.binaryType = "arraybuffer";

          upstreamSockets.set(client, upstream);
          pendingOutbound.set(client, []);

          upstream.addEventListener("open", () => {
            const queued = pendingOutbound.get(client) ?? [];
            for (const message of queued) {
              upstream.send(message as string & ArrayBufferLike);
            }
            pendingOutbound.delete(client);
          });

          upstream.addEventListener("message", (event) => {
            try {
              client.send(event.data);
            } catch (error) {
              console.error("[gateway] failed to relay upstream -> client:", error);
            }
          });

          upstream.addEventListener("close", (event) => {
            safeClose(client, event.code, event.reason);
          });

          upstream.addEventListener("error", (event) => {
            console.error("[gateway] upstream websocket error:", event);
            safeClose(client, 1011, "Upstream connection error");
          });
        } catch (error) {
          console.error("[gateway] failed to open upstream websocket tunnel:", error);
          safeClose(client, 1011, "Gateway failed to reach upstream");
        }
      },

      message(client: ServerWebSocket<TunnelSocketData>, message: string | Uint8Array) {
        try {
          const upstream = upstreamSockets.get(client);
          if (!upstream) return;

          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(message as string & ArrayBufferLike);
          } else {
            pendingOutbound.get(client)?.push(message);
          }
        } catch (error) {
          console.error("[gateway] failed to relay client -> upstream:", error);
        }
      },

      close(client: ServerWebSocket<TunnelSocketData>) {
        const upstream = upstreamSockets.get(client);
        if (upstream) {
          safeClose(upstream);
        }
        upstreamSockets.delete(client);
        pendingOutbound.delete(client);
      },
    },
  };
}
