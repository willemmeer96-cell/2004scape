/**
 * Central config loader for the gateway. Every runtime mode reads from
 * this shape so adding a new mode never means inventing a new env var
 * convention.
 */

export type GatewayMode = "official-proxy";

export interface GatewayConfig {
  mode: GatewayMode;
  port: number;
  /** Origin of the legacy application we are proxying, e.g. https://legacy-app.example.com */
  targetOrigin: string;
  /** Path to the JS payload injected into proxied HTML pages. */
  injectScriptPath: string;
}

const DEFAULT_PORT = 4310;
const DEFAULT_INJECT_SCRIPT_PATH = new URL("./inject/telemetry-inject.js", import.meta.url)
  .pathname;

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): GatewayConfig {
  return {
    mode: (process.env.GATEWAY_MODE as GatewayMode) ?? "official-proxy",
    port: Number(process.env.GATEWAY_PORT ?? DEFAULT_PORT),
    targetOrigin: required("TARGET_ORIGIN", "https://example.com"),
    injectScriptPath: process.env.INJECT_SCRIPT_PATH ?? DEFAULT_INJECT_SCRIPT_PATH,
  };
}
