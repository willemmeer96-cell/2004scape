/**
 * http.ts (official-proxy mode)
 *
 * Handles plain HTTP requests: fetches the official, external HTML/JS
 * assets as-is from `config.targetOrigin` and re-serves them locally.
 * HTML responses pass through the telemetry-injection middleware; every
 * other asset type (JS, CSS, images, fonts) is streamed through
 * untouched. WebSocket upgrade requests never reach this handler — they
 * are intercepted earlier and routed to ./websocket.ts instead.
 */

import { applyTelemetryInjection } from "../../middleware";
import type { GatewayConfig } from "../../config";

const HOP_BY_HOP_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

function isHtmlResponse(headers: Headers): boolean {
  const contentType = headers.get("content-type") ?? "";
  return contentType.includes("text/html");
}

function cloneSafeHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  return headers;
}

export function createHttpProxyHandler(config: GatewayConfig) {
  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const upstreamUrl = new URL(url.pathname + url.search, config.targetOrigin);

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers: request.headers,
        redirect: "manual",
      });
    } catch (error) {
      console.error("[gateway] upstream fetch failed:", error);
      return new Response("Upstream application unreachable", { status: 502 });
    }

    const headers = cloneSafeHeaders(upstreamResponse.headers);

    if (!isHtmlResponse(upstreamResponse.headers)) {
      // Non-HTML assets pass through unmodified and unbuffered.
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers,
      });
    }

    let originalHtml: string;
    try {
      originalHtml = await upstreamResponse.text();
    } catch (error) {
      console.error("[gateway] failed to read upstream HTML body:", error);
      return new Response("Upstream returned an unreadable response", { status: 502 });
    }

    // applyTelemetryInjection never throws, but the outer try/catch is
    // kept as a last-resort guarantee: whatever happens, we always have
    // `originalHtml` ready to serve unmodified.
    let finalHtml = originalHtml;
    try {
      finalHtml = await applyTelemetryInjection(originalHtml, config.injectScriptPath);
    } catch (error) {
      console.error("[gateway] HTML injection failed, serving original page:", error);
      finalHtml = originalHtml;
    }

    return new Response(finalHtml, {
      status: upstreamResponse.status,
      headers,
    });
  };
}
