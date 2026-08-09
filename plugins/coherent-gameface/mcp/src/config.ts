/**
 * Runtime configuration for the Gameface MCP server, sourced from environment variables so the
 * same bundle works against any Gameface application / debug port.
 */

const DEFAULT_PORT = 9444;
const DEFAULT_PORT_FILE_KEY = 'port';
const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_CALL_TIMEOUT_MS = 15_000;

export interface Config {
  /**
   * Host the Gameface CDP endpoint listens on.
   */
  readonly host: string;

  /**
   * Port the Gameface CDP endpoint listens on (common default: 9444).
   */
  readonly port: number;

  /**
   * Whether GAMEFACE_PORT named that port, as opposed to it falling back to the default. Only
   * affects reporting: an endpoint nobody asked for reads differently from one that was set.
   */
  readonly portIsExplicit: boolean;

  /**
   * Optional file a launcher writes the live port to, re-read on every connection attempt so the
   * server follows a game launched (or relaunched) on a port chosen after this process started.
   * Either a bare number or a JSON object carrying it under `portFileKey`.
   */
  readonly portFile: string | undefined;

  /**
   * Key holding the port when the port file is a JSON object (a bare number needs no key).
   */
  readonly portFileKey: string;

  /**
   * How long to wait for HTTP discovery / WebSocket opening before giving up.
   */
  readonly connectTimeoutMs: number;

  /**
   * How long to wait for a single CDP command reply before giving up.
   */
  readonly callTimeoutMs: number;
}

/**
 * Builds the config from GAMEFACE_* env vars, falling back to defaults.
 */
export function loadConfig(): Config {
  // Resolved with a 0 fallback so "unset or unusable" is distinguishable from a real value.
  const envPort = num(process.env.GAMEFACE_PORT, 0);

  return {
    host: str(process.env.GAMEFACE_HOST, 'localhost'),
    port: envPort > 0 ? envPort : DEFAULT_PORT,
    portIsExplicit: envPort > 0,
    portFile: optional(process.env.GAMEFACE_PORT_FILE),
    portFileKey: str(process.env.GAMEFACE_PORT_FILE_KEY, DEFAULT_PORT_FILE_KEY),
    connectTimeoutMs: num(process.env.GAMEFACE_CONNECT_TIMEOUT_MS, DEFAULT_CONNECT_TIMEOUT_MS),
    callTimeoutMs: num(process.env.GAMEFACE_CALL_TIMEOUT_MS, DEFAULT_CALL_TIMEOUT_MS)
  };
}

/**
 * Reads a string setting. An empty or whitespace-only env value counts as unset and falls back.
 */
function str(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? '';

  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * Reads an optional string setting, with the same empty-counts-as-unset rule as str().
 */
function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';

  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Reads a positive-number setting. Missing, non-numeric, zero, or negative values fall back.
 */
function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
