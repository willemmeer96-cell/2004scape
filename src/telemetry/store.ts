/**
 * store.ts
 *
 * Tiny in-memory pub/sub for the latest telemetry snapshot. Deliberately
 * process-local (no persistence, no database) -- this is a local dev
 * dashboard, restarting the gateway is an acceptable way to clear state.
 */

export interface TelemetryEntity {
  x: number;
  z: number;
}

export interface TelemetryLocalPlayer extends TelemetryEntity {
  level: number | null;
}

export interface TelemetrySnapshot {
  capturedAt: number;
  localPlayer: TelemetryLocalPlayer | null;
  players: TelemetryEntity[];
  npcs: TelemetryEntity[];
}

export interface TelemetryEnvelope {
  snapshot: TelemetrySnapshot;
  receivedAt: number;
}

type Listener = (envelope: TelemetryEnvelope) => void;

let latest: TelemetryEnvelope | null = null;
const listeners = new Set<Listener>();

export function publishSnapshot(snapshot: TelemetrySnapshot): TelemetryEnvelope {
  const envelope: TelemetryEnvelope = { snapshot, receivedAt: Date.now() };
  latest = envelope;

  for (const listener of listeners) {
    try {
      listener(envelope);
    } catch (error) {
      // A broken subscriber (e.g. a dropped SSE connection mid-write)
      // must never take down publishing for the others.
      console.error("[telemetry] subscriber threw, dropping it:", error);
      listeners.delete(listener);
    }
  }

  return envelope;
}

export function getLatestEnvelope(): TelemetryEnvelope | null {
  return latest;
}

/** Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
