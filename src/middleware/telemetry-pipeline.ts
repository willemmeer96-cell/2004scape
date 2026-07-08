/**
 * telemetry-pipeline.ts
 *
 * Gateway-facing glue: reads the injectable script from disk (cached) and
 * applies it via `injectBeforeClosingBody`. Kept separate from
 * inject-html.ts so the actual string-injection logic stays pure and has
 * no I/O to mock in tests.
 */

import { readFile } from "node:fs/promises";
import { injectBeforeClosingBody, type InjectOptions } from "./inject-html";

let cachedScript: string | null = null;
let cachedScriptPath: string | null = null;

/**
 * Loads and caches the telemetry script contents. Cache is keyed on path
 * so switching INJECT_SCRIPT_PATH at runtime (e.g. in tests) still works.
 * Never throws: on a read failure it logs and returns an empty string, so
 * downstream injection simply becomes a no-op instead of crashing requests.
 */
export async function loadTelemetryScript(path: string): Promise<string> {
  if (cachedScript !== null && cachedScriptPath === path) {
    return cachedScript;
  }

  try {
    cachedScript = await readFile(path, "utf-8");
    cachedScriptPath = path;
  } catch (error) {
    console.error(`[gateway] could not read telemetry script at "${path}":`, error);
    cachedScript = "";
    cachedScriptPath = path;
  }

  return cachedScript;
}

/** Drops the cached script so the next request re-reads it from disk. */
export function invalidateTelemetryScriptCache(): void {
  cachedScript = null;
  cachedScriptPath = null;
}

export async function applyTelemetryInjection(
  html: string,
  scriptPath: string,
  options?: InjectOptions
): Promise<string> {
  try {
    const script = await loadTelemetryScript(scriptPath);
    if (!script) {
      return html;
    }

    const { html: patched } = injectBeforeClosingBody(html, script, {
      markerId: options?.markerId,
      onError: (err, ctx) => console.error(`[gateway] injection failed in ${ctx}:`, err),
    });

    return patched;
  } catch (error) {
    // Belt-and-braces: injectBeforeClosingBody already never throws, but
    // loadTelemetryScript or option handling still could in principle.
    console.error("[gateway] telemetry injection pipeline failed, serving original html:", error);
    return html;
  }
}
