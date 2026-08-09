/**
 * Resolution of the CDP endpoint the server talks to.
 *
 * The port a game serves DevTools on is usually chosen when the game launches, which on most agent
 * harnesses is long after the MCP server started and read its environment: a server that resolved
 * its port once, at startup, can never follow that game. So the endpoint is resolved per connection
 * attempt instead, from the first source that names a port: a runtime override (the game_target
 * tool), then a port file the launcher writes, then the environment, then the built-in default.
 */

import { readFile } from 'node:fs/promises';
import type { Config } from './config';

const MAX_PORT = 65_535;

/**
 * Where the port in use came from, reported so a surprising endpoint stays traceable.
 */
export type EndpointSource = 'override' | 'file' | 'env' | 'default';

/**
 * A resolved CDP endpoint plus the provenance of its port.
 */
export interface Endpoint {
  readonly host: string;
  readonly port: number;
  readonly source: EndpointSource;
}

/**
 * The outcome of the last port-file read, kept for reporting: a configured file that names no
 * usable port is a misconfiguration worth surfacing, not something to fall back from in silence.
 */
export interface PortFileStatus {
  readonly path: string;
  readonly key: string;
  readonly port: number | undefined;
  readonly error: string | undefined;
}

/**
 * Resolves the endpoint on demand and holds the runtime override.
 */
export class EndpointResolver {
  private readonly cfg: Config;

  private hostOverride: string | undefined;
  private portOverride: number | undefined;

  private lastPortFile: PortFileStatus | undefined;
  private lastEndpoint: Endpoint;

  public constructor(cfg: Config) {
    this.cfg = cfg;
    this.lastEndpoint = staticEndpoint(cfg);
  }

  /**
   * The endpoint of the most recent resolve(), for reporting from synchronous code.
   * Before the first resolve() it is the environment's (or the default), which is also what the
   * next resolve() returns unless a port file says otherwise.
   */
  public get current(): Endpoint {
    return this.lastEndpoint;
  }

  /**
   * The last port-file read, or undefined when no port file is configured.
   */
  public get portFile(): PortFileStatus | undefined {
    return this.lastPortFile;
  }

  /**
   * Whether an override currently pins the endpoint.
   */
  public get hasOverride(): boolean {
    return this.hostOverride != undefined || this.portOverride != undefined;
  }

  /**
   * Re-resolves the endpoint, re-reading the port file when one is configured, so a game
   * relaunched on another port is picked up by the next connection.
   */
  public async resolve(): Promise<Endpoint> {
    const host = this.hostOverride ?? this.cfg.host;

    if (this.portOverride != undefined) {
      return this.remember({ host, port: this.portOverride, source: 'override' });
    }

    const fromFile = await this.readPortFile();

    if (fromFile != undefined) {
      return this.remember({ host, port: fromFile, source: 'file' });
    }

    const { port, source } = staticEndpoint(this.cfg);

    return this.remember({ host, port, source });
  }

  /**
   * Pins host and/or port until cleared. An undefined argument leaves that half as it was, so a
   * port-only retarget keeps a host override in place.
   */
  public setOverride(host: string | undefined, port: number | undefined): void {
    if (host != undefined) {
      this.hostOverride = host;
    }

    if (port != undefined) {
      this.portOverride = port;
    }
  }

  /**
   * Drops the override, handing the endpoint back to the port file / environment.
   */
  public clearOverride(): void {
    this.hostOverride = undefined;
    this.portOverride = undefined;
  }

  /**
   * Reads the configured port file, recording why it did not yield a port when it did not.
   */
  private async readPortFile(): Promise<number | undefined> {
    const path = this.cfg.portFile;

    if (path == undefined) {
      this.lastPortFile = undefined;

      return undefined;
    }

    const key = this.cfg.portFileKey;
    let raw: string;

    try {
      raw = await readFile(path, 'utf8');
    } catch (error) {
      // A missing file is the normal state before the first launch, so this is not fatal: it is
      // recorded and the environment / default takes over.
      this.lastPortFile = { path, key, port: undefined, error: describeError(error) };

      return undefined;
    }

    const { port, error } = parsePortFile(raw, key);

    this.lastPortFile = { path, key, port, error };

    return port;
  }

  private remember(endpoint: Endpoint): Endpoint {
    this.lastEndpoint = endpoint;

    return endpoint;
  }
}

/**
 * The endpoint the static configuration alone describes (no override, no port file).
 */
function staticEndpoint(cfg: Config): Endpoint {
  return { host: cfg.host, port: cfg.port, source: cfg.portIsExplicit ? 'env' : 'default' };
}

/**
 * Extracts a port from a port file's contents: either a bare number, or the named key of a JSON
 * object (launchers tend to write a record of the instance rather than the port on its own).
 */
function parsePortFile(raw: string, key: string): { port?: number; error?: string } {
  const trimmed = raw.trim();

  if (trimmed.length == 0) {
    return { error: `file is empty` };
  }

  if (/^\d+$/u.test(trimmed)) {
    return validatePort(Number(trimmed), `file`);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { error: `not a bare port number, and not valid JSON` };
  }

  if (typeof parsed != 'object' || parsed == null || Array.isArray(parsed)) {
    return { error: `JSON is not an object, so key '${key}' cannot be read from it` };
  }

  const value = (parsed as Record<string, unknown>)[key];

  if (value == undefined) {
    return { error: `JSON object has no '${key}' (set GAMEFACE_PORT_FILE_KEY to the right key)` };
  }

  if (typeof value != 'number' && typeof value != 'string') {
    return { error: `'${key}' is ${typeof value}, expected a number` };
  }

  return validatePort(Number(value), `'${key}'`);
}

/**
 * Accepts only a whole, in-range port, so a malformed file cannot send the connection somewhere
 * arbitrary.
 */
function validatePort(port: number, label: string): { port?: number; error?: string } {
  if (!Number.isInteger(port) || port <= 0 || port > MAX_PORT) {
    return { error: `${label} is not a valid port: ${port}` };
  }

  return { port };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
