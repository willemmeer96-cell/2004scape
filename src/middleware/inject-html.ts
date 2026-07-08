/**
 * inject-html.ts
 *
 * Pure, framework-agnostic HTML injection. No file I/O, no network calls —
 * just string manipulation, so it stays trivially unit-testable and has
 * nothing else that can fail besides the string operations themselves.
 *
 * Hard guarantee: this module NEVER throws. On any failure — malformed
 * input, missing tags, an unexpected exception — it falls back to
 * returning the original, untouched HTML. The proxied application must
 * always keep working, even if the injected telemetry code is broken.
 */

const BODY_CLOSE_TAG = /<\/body\s*>/i;
const HTML_CLOSE_TAG = /<\/html\s*>/i;
const MARKER_ATTR = "data-telemetry-injected";

export interface InjectOptions {
  /** Unique id for this injection; also guards against double-injection. */
  markerId?: string;
  /** Called on any failure or fallback path. Never thrown, purely informational. */
  onError?: (error: unknown, context: string) => void;
}

export interface InjectResult {
  html: string;
  injected: boolean;
}

const DEFAULT_OPTIONS: Required<Pick<InjectOptions, "markerId">> = {
  markerId: "telemetry-panel",
};

/**
 * Wraps raw injected JS in a defensive <script> tag:
 *  - the marker attribute makes injection idempotent (safe to run twice)
 *  - the runtime try/catch stops a bug in the injected script from
 *    surfacing as an uncaught exception in the host page. Note this does
 *    NOT (and cannot) protect against a hard JS *syntax* error — but a
 *    syntax error only aborts parsing of this single <script> block; the
 *    browser isolates that failure and the rest of the page, including
 *    every other <script> tag, keeps running regardless.
 */
function wrapAsSafeScript(rawJs: string, markerId: string): string {
  return [
    `<script ${MARKER_ATTR}="${markerId}">`,
    `(function () {`,
    `  try {`,
    rawJs,
    `  } catch (err) {`,
    `    console.error("[telemetry] injected script threw at runtime:", err);`,
    `  }`,
    `})();`,
    `</script>`,
  ].join("\n");
}

/**
 * Injects `injection` (raw JS, not pre-wrapped) right before the closing
 * </body> tag of `html`. Falls back to </html>, then to appending at the
 * very end of the document, if the expected tags aren't found. Whatever
 * happens, the returned html is always at least the original input.
 */
export function injectBeforeClosingBody(
  html: string,
  injection: string,
  options: InjectOptions = {}
): InjectResult {
  const markerId = options.markerId ?? DEFAULT_OPTIONS.markerId;
  const onError = options.onError;

  try {
    if (typeof html !== "string" || html.length === 0) {
      return { html, injected: false };
    }
    if (typeof injection !== "string" || injection.trim().length === 0) {
      return { html, injected: false };
    }

    // Idempotency guard: don't double-inject (e.g. if middleware runs
    // twice on the same response due to a retry or redirect chain).
    if (html.includes(`${MARKER_ATTR}="${markerId}"`)) {
      return { html, injected: false };
    }

    const scriptTag = wrapAsSafeScript(injection, markerId);

    const bodyMatch = html.match(BODY_CLOSE_TAG);
    if (bodyMatch && typeof bodyMatch.index === "number") {
      return { html: spliceAt(html, bodyMatch.index, scriptTag), injected: true };
    }

    // Fallback #1: no </body> — try right before </html>.
    const htmlMatch = html.match(HTML_CLOSE_TAG);
    if (htmlMatch && typeof htmlMatch.index === "number") {
      return { html: spliceAt(html, htmlMatch.index, scriptTag), injected: true };
    }

    // Fallback #2: neither tag exists (fragment / non-standard document).
    // Append rather than silently dropping the panel.
    return { html: `${html}\n${scriptTag}`, injected: true };
  } catch (error) {
    onError?.(error, "injectBeforeClosingBody");
    // Absolute safety net: no matter what went wrong above, the original
    // application must still be served.
    return { html, injected: false };
  }
}

function spliceAt(html: string, index: number, insertion: string): string {
  return `${html.slice(0, index)}${insertion}\n${html.slice(index)}`;
}
