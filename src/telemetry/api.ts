/**
 * api.ts
 *
 * Local-only HTTP surface for the telemetry dashboard, mounted under
 * /__telemetry/* by the gateway (see modes/official-proxy/index.ts)
 * *before* any request reaches the upstream proxy or the WebSocket
 * tunnel. Nothing here ever talks to the proxied application.
 *
 * Every request body is treated as untrusted: the injected page script
 * is ours, but a malformed or stale payload must never crash the
 * gateway process, so shapes are checked field-by-field rather than
 * trusted wholesale.
 */

import { readFile } from "node:fs/promises";
import { getLatestEnvelope, publishSnapshot, subscribe, type TelemetryEntity, type TelemetrySnapshot } from "./store";

const ROUTE_PREFIX = "/__telemetry";
// Upper bound so a malformed or runaway payload can't balloon memory or
// the JSON response size; real scenes are two to three orders of
// magnitude smaller than this.
const MAX_ENTITIES = 4096;

const DASHBOARD_HTML_PATH = new URL("./dashboard.html", import.meta.url).pathname;
let cachedDashboardHtml: string | null = null;

async function loadDashboardHtml(): Promise<string> {
  if (cachedDashboardHtml !== null) {
    return cachedDashboardHtml;
  }
  try {
    cachedDashboardHtml = await readFile(DASHBOARD_HTML_PATH, "utf-8");
  } catch (error) {
    console.error("[telemetry] failed to read dashboard.html:", error);
    cachedDashboardHtml = "<!doctype html><title>dashboard unavailable</title><p>dashboard.html failed to load.</p>";
  }
  return cachedDashboardHtml;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeEntityList(value: unknown): TelemetryEntity[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const out: TelemetryEntity[] = [];
  for (const entry of value) {
    if (out.length >= MAX_ENTITIES) break;
    if (!entry || typeof entry !== "object") continue;

    const record = entry as Record<string, unknown>;
    if (isFiniteNumber(record.x) && isFiniteNumber(record.z)) {
      out.push({ x: record.x, z: record.z });
    }
  }
  return out;
}

function sanitizeSnapshot(body: unknown): TelemetrySnapshot | null {
  if (!body || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;

  let localPlayer: TelemetrySnapshot["localPlayer"] = null;
  if (record.localPlayer && typeof record.localPlayer === "object") {
    const lp = record.localPlayer as Record<string, unknown>;
    if (isFiniteNumber(lp.x) && isFiniteNumber(lp.z)) {
      localPlayer = {
        x: lp.x,
        z: lp.z,
        level: isFiniteNumber(lp.level) ? lp.level : null,
      };
    }
  }

  return {
    capturedAt: isFiniteNumber(record.capturedAt) ? record.capturedAt : Date.now(),
    localPlayer,
    players: sanitizeEntityList(record.players),
    npcs: sanitizeEntityList(record.npcs),
  };
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

function sseEvent(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function createSseResponse(): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // Client likely disconnected mid-write; cancel() will clean up.
        }
      };

      const current = getLatestEnvelope();
      if (current) {
        send(sseEvent(current));
      }

      unsubscribe = subscribe(envelope => send(sseEvent(envelope)));
      // Keeps intermediary proxies/browsers from timing out an idle stream.
      heartbeat = setInterval(() => send(": ping\n\n"), 15000);
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

/**
 * Returns a Response for any request under /__telemetry, or `null` if
 * `pathname` isn't a telemetry route at all (caller should continue on
 * to the normal proxy handling in that case).
 */
export function createTelemetryApiHandler() {
  return async function handleTelemetryRequest(request: Request, pathname: string): Promise<Response | null> {
    if (!pathname.startsWith(ROUTE_PREFIX)) {
      return null;
    }

    try {
      if (pathname === `${ROUTE_PREFIX}/ingest` && request.method === "POST") {
        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: "invalid json" }, { status: 400 });
        }

        const snapshot = sanitizeSnapshot(body);
        if (!snapshot) {
          return jsonResponse({ error: "invalid snapshot shape" }, { status: 400 });
        }

        publishSnapshot(snapshot);
        return jsonResponse({ ok: true });
      }

      if (pathname === `${ROUTE_PREFIX}/snapshot` && request.method === "GET") {
        return jsonResponse(getLatestEnvelope());
      }

      if (pathname === `${ROUTE_PREFIX}/stream` && request.method === "GET") {
        return createSseResponse();
      }

      if ((pathname === ROUTE_PREFIX || pathname === `${ROUTE_PREFIX}/`) && request.method === "GET") {
        const html = await loadDashboardHtml();
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      return new Response("Not found", { status: 404 });
    } catch (error) {
      // Last-resort net: a telemetry route must never crash the gateway
      // or fall through to the upstream proxy by accident.
      console.error("[telemetry] request handling failed:", error);
      return new Response("Internal telemetry error", { status: 500 });
    }
  };
}
