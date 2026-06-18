import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TunnelState, TunnelEntry } from '../types.js';

/**
 * Resolves a path that may start with ~ to use the user's home directory.
 */
function resolvePath(filePath: string): string {
  if (filePath.startsWith('~')) {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

/**
 * Reads and parses the tunnel state file.
 * Returns an empty state if the file is missing or corrupted.
 */
export function readState(statePath: string): TunnelState {
  const resolved = resolvePath(statePath);
  try {
    const content = fs.readFileSync(resolved, 'utf-8');
    return JSON.parse(content) as TunnelState;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) {
      console.warn(`Warning: State file at ${resolved} is corrupted, resetting state.`);
    }
    // File missing (ENOENT) or corrupted — return empty state
    return { tunnels: [] };
  }
}

/**
 * Atomically writes the tunnel state to disk.
 * Ensures the parent directory exists before writing.
 */
export function writeState(statePath: string, state: TunnelState): void {
  const resolved = resolvePath(statePath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(state, null, 2));
}

/**
 * Adds a tunnel entry to the state file.
 */
export function addTunnel(statePath: string, entry: TunnelEntry): void {
  const state = readState(statePath);
  state.tunnels.push(entry);
  writeState(statePath, state);
}

/**
 * Removes a tunnel entry by cluster name from the state file.
 */
export function removeTunnel(statePath: string, clusterName: string): void {
  const state = readState(statePath);
  state.tunnels = state.tunnels.filter(t => t.clusterName !== clusterName);
  writeState(statePath, state);
}

/**
 * Checks if a process with the given PID is alive.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Removes tunnel entries whose PIDs are no longer running.
 * Returns the stale entries that were removed.
 */
export function cleanStaleTunnels(statePath: string): TunnelEntry[] {
  const state = readState(statePath);
  const live: TunnelEntry[] = [];
  const stale: TunnelEntry[] = [];

  for (const entry of state.tunnels) {
    if (isProcessAlive(entry.pid)) {
      live.push(entry);
    } else {
      stale.push(entry);
    }
  }

  writeState(statePath, { tunnels: live });
  return stale;
}
