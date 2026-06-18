import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TunnelEntry } from '../../src/types.js';
import { cleanStaleTunnels, readState } from '../../src/modules/state-manager.js';
import { progress } from '../../src/modules/output-formatter.js';

/**
 * Property 13: Stale Tunnel Cleanup
 *
 * For any tunnel state file containing entries whose PIDs are no longer running,
 * after cleanup all stale entries SHALL be removed from the state file and only
 * entries with live processes SHALL remain.
 *
 * **Validates: Requirements 12.2, 12.3**
 */

/**
 * Property 16: Quiet Mode Suppresses Progress
 *
 * For any CLI operation with the --quiet flag enabled, the output SHALL not contain
 * progress step markers (the "→" prefix messages), and SHALL only contain the final
 * result or error messages.
 *
 * **Validates: Requirements 15.4**
 */

// Custom arbitrary for TunnelEntry
const arbTunnelEntry = fc.record({
  clusterName: fc.stringMatching(/^[a-z][a-z0-9-]{3,20}$/),
  accountName: fc.string({ minLength: 1, maxLength: 20 }),
  accountId: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 12, maxLength: 12 }),
  profile: fc.string({ minLength: 1, maxLength: 20 }),
  region: fc.constantFrom('us-east-1', 'eu-west-1'),
  localPort: fc.integer({ min: 8443, max: 65535 }),
  pid: fc.integer({ min: 1, max: 99999 }),
  endpoint: fc.constant('https://test.eks.amazonaws.com'),
  bastionId: fc.stringMatching(/^i-[0-9a-f]{17}$/),
  contextName: fc.stringMatching(/^eks-tunnel-[a-z][a-z0-9-]{3,20}$/),
  startedAt: fc.constant('2024-01-15T10:30:00Z'),
});

describe('Property 13: Stale Tunnel Cleanup', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-tunnel-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('after cleanup, only entries with live PIDs remain and stale entries are returned', () => {
    fc.assert(
      fc.property(
        // Generate an array of tunnel entries with unique cluster names
        fc.array(arbTunnelEntry, { minLength: 1, maxLength: 10 }).chain((entries) => {
          // Ensure unique cluster names to avoid collisions
          const seen = new Set<string>();
          const uniqueEntries = entries.filter((e) => {
            if (seen.has(e.clusterName)) return false;
            seen.add(e.clusterName);
            return true;
          });
          if (uniqueEntries.length === 0) {
            return fc.constant({ entries: [entries[0]], alivePids: new Set<number>() });
          }
          // Generate which PIDs are alive (random subset)
          const pids = uniqueEntries.map((e) => e.pid);
          return fc.subarray(pids).map((aliveSubset) => ({
            entries: uniqueEntries,
            alivePids: new Set(aliveSubset),
          }));
        }),
        ({ entries, alivePids }) => {
          // Write state file to temp dir
          const statePath = path.join(tmpDir, 'state.json');
          fs.writeFileSync(statePath, JSON.stringify({ tunnels: entries }, null, 2));

          // Mock process.kill to control which PIDs are "alive"
          const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
            if (signal === 0) {
              if (alivePids.has(pid)) {
                return true;
              }
              const err = new Error('ESRCH') as NodeJS.ErrnoException;
              err.code = 'ESRCH';
              throw err;
            }
            return true;
          });

          // Call cleanStaleTunnels
          const staleEntries = cleanStaleTunnels(statePath);

          // Read resulting state
          const resultState = readState(statePath);

          // Determine expected live and stale entries
          const expectedLive = entries.filter((e) => alivePids.has(e.pid));
          const expectedStale = entries.filter((e) => !alivePids.has(e.pid));

          // Property: The remaining tunnels should be exactly the live entries
          expect(resultState.tunnels.length).toBe(expectedLive.length);
          for (const liveEntry of expectedLive) {
            const found = resultState.tunnels.find(
              (t: TunnelEntry) => t.clusterName === liveEntry.clusterName && t.pid === liveEntry.pid
            );
            expect(found).toBeDefined();
          }

          // Property: The returned stale entries should be exactly the dead entries
          expect(staleEntries.length).toBe(expectedStale.length);
          for (const deadEntry of expectedStale) {
            const found = staleEntries.find(
              (t: TunnelEntry) => t.clusterName === deadEntry.clusterName && t.pid === deadEntry.pid
            );
            expect(found).toBeDefined();
          }

          // Property: No dead PID entries should remain in state
          for (const tunnel of resultState.tunnels) {
            expect(alivePids.has(tunnel.pid)).toBe(true);
          }

          killSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 16: Quiet Mode Suppresses Progress', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('with quiet=true, progress produces no output for any message', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (message) => {
          consoleSpy.mockClear();

          progress(message, { json: false, quiet: true });

          // No output should be produced
          expect(consoleSpy).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('with quiet=false and json=false, progress produces output starting with "→"', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        (message) => {
          consoleSpy.mockClear();

          progress(message, { json: false, quiet: false });

          // Output should be produced
          expect(consoleSpy).toHaveBeenCalledTimes(1);
          const output = consoleSpy.mock.calls[0][0] as string;
          // Output should start with "→"
          expect(output.startsWith('→')).toBe(true);
          // Output should contain the message
          expect(output).toBe(`→ ${message}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('with json=true, progress produces no output regardless of quiet flag', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 200 }),
        fc.boolean(),
        (message, quiet) => {
          consoleSpy.mockClear();

          progress(message, { json: true, quiet });

          // No output should be produced in JSON mode
          expect(consoleSpy).not.toHaveBeenCalled();
        }
      ),
      { numRuns: 100 }
    );
  });
});
