/**
 * telemetry-inject.js
 *
 * Injected into the proxied application's page by the official-proxy
 * middleware (see src/middleware/inject-html.ts). Wrapped in an IIFE so
 * it runs in its own scope and never leaks variables into — or collides
 * with — the host application's globals.
 *
 * Intentionally empty for now. Telemetry collection and panel rendering
 * logic is added in a later step.
 */
(function telemetryPanel(global) {
  "use strict";

  // Namespace for everything this panel exposes, kept off the raw
  // window object to avoid clashing with the host application.
  var NAMESPACE = "__telemetryPanel";

  if (global[NAMESPACE]) {
    // Already initialized (e.g. injected more than once) — no-op.
    return;
  }

  var state = {
    initialized: true,
  };

  global[NAMESPACE] = state;

  // TODO: telemetry collection & panel rendering logic.
})(window);
