/**
 * telemetry-inject.js
 *
 * Injected into the proxied application's page by the official-proxy
 * middleware (see src/middleware/inject-html.ts). Wrapped in an IIFE so
 * it runs in its own scope and never leaks variables into -- or collides
 * with -- the host application's globals.
 *
 * IMPORTANT (2004scape/Client2-style clients): the game instance
 * (a `Game` class holding `localPlayer`, `players[]`, `npcs[]`, ...) is a
 * webpack module-scoped object. It is NOT exposed on `window` in an
 * unmodified build, so this script cannot reach it "by magic". For a
 * local/private dev build, expose it yourself with one line, e.g. inside
 * the `Game` class constructor or main loop:
 *
 *   (window as any).__gameState = this;
 *
 * This mirrors how reference automation tooling (e.g. rs-sdk) works: it
 * runs against a purpose-built "enhanced" local client build rather than
 * reaching into an unmodified bundle's closures. Until such a hook is
 * present, this script just waits silently -- it never assumes the
 * object exists.
 */
(function telemetryPanel(global) {
  "use strict";

  var NAMESPACE = "__telemetryPanel";

  if (global[NAMESPACE]) {
    // Already initialized (e.g. injected more than once) -- no-op.
    return;
  }

  var CONFIG = {
    pollIntervalMs: 500,
    // Candidate global property names to look for the running game
    // instance under. Add your own local build's hook name here if it
    // differs -- see the module comment above.
    resolverPaths: ["__gameState", "game", "client"],
  };

  var state = {
    initialized: true,
    // "waiting-for-client" | "connected" | "lost-client"
    status: "waiting-for-client",
    lastError: null,
    snapshot: null,
    lastUpdatedAt: null,
  };

  global[NAMESPACE] = state;

  function safeGet(obj, path) {
    try {
      var parts = path.split(".");
      var current = obj;
      for (var i = 0; i < parts.length; i++) {
        if (current === null || current === undefined) {
          return undefined;
        }
        current = current[parts[i]];
      }
      return current;
    } catch (err) {
      return undefined;
    }
  }

  function resolveGameInstance() {
    for (var i = 0; i < CONFIG.resolverPaths.length; i++) {
      var candidate = safeGet(global, CONFIG.resolverPaths[i]);
      if (candidate && typeof candidate === "object") {
        return candidate;
      }
    }
    return null;
  }

  function extractLocalPlayer(instance) {
    var player = instance.localPlayer;
    if (!player || typeof player !== "object") {
      return null;
    }

    var x = typeof player.x === "number" ? player.x : null;
    var z = typeof player.z === "number" ? player.z : null;
    if (x === null || z === null) {
      return null;
    }

    return {
      x: x,
      z: z,
      level: typeof instance.currentLevel === "number" ? instance.currentLevel : null,
    };
  }

  function extractEntityList(instance, listKey, countKey) {
    var list = instance[listKey];
    if (!Array.isArray(list)) {
      return [];
    }

    var count = typeof instance[countKey] === "number" ? instance[countKey] : list.length;
    var out = [];

    for (var i = 0; i < count; i++) {
      var entity = list[i];
      if (!entity || typeof entity !== "object") {
        continue;
      }
      if (typeof entity.x !== "number" || typeof entity.z !== "number") {
        continue;
      }
      out.push({ x: entity.x, z: entity.z });
    }

    return out;
  }

  function buildSnapshot(instance) {
    return {
      capturedAt: Date.now(),
      localPlayer: extractLocalPlayer(instance),
      players: extractEntityList(instance, "players", "playerCount"),
      npcs: extractEntityList(instance, "npcs", "npcCount"),
    };
  }

  function tick() {
    try {
      var instance = resolveGameInstance();

      if (!instance) {
        // Client not loaded yet, or no exposure hook found under any of
        // the configured resolver paths. This is expected during page
        // load, or permanently if the local build hasn't added the
        // debug hook yet -- either way, keep waiting quietly.
        state.status = "waiting-for-client";
        return;
      }

      var snapshot = buildSnapshot(instance);
      state.snapshot = snapshot;
      state.status = "connected";
      state.lastUpdatedAt = snapshot.capturedAt;
      state.lastError = null;
    } catch (err) {
      // A shape mismatch or a read racing a mid-frame mutation must never
      // tear the polling loop down. Record the error for debugging and
      // simply retry on the next tick.
      state.status = "lost-client";
      state.lastError = String((err && err.message) || err);
      console.error("[telemetry] tick failed, will retry:", err);
    }
  }

  // Public, read-only accessor for whatever we've captured so far --
  // this is what the future dashboard-delivery step will read from.
  state.getSnapshot = function () {
    return state.snapshot;
  };

  try {
    state._intervalId = global.setInterval(tick, CONFIG.pollIntervalMs);
    tick();
  } catch (err) {
    // Even the interval setup itself is guarded: worst case, the panel
    // stays inert instead of breaking the host page.
    state.status = "lost-client";
    state.lastError = String((err && err.message) || err);
    console.error("[telemetry] failed to start polling:", err);
  }
})(window);
