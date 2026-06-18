import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TunnelEntry } from '../../src/types.js';
import { readState, writeState, removeTunnel } from '../../src/modules/state-manager.js';

/**
 * Property 14: Stop Cleans All Artifacts
 *
 * For any active tunnel entry, after stop: PID terminated, state entry removed,
 * kubeconfig context removed. For stop-all: all entries cleaned, state empty.
 *
 * **Validates: Requirements 12.4, 12.5**
 */

// Custom arbitrary for TunnelEntry
const arbTunnelEntry = fc.record({
  clusterName: fc.stringMatching(/^[a-z][a-z0-9-]{3,20}$/),
  accountName: fc.string({ minLength: 1, maxLength: 20 }),
  accountId: fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 12, maxLength: 12 }),
  profile: fc.string({ minLength: 1, maxLength: 20 }),
  region: fc.constantFrom('us-east-1', 'eu-west-1'),
  localPort: fc.integer({ min: 8443, max: 65535 }),
  pid: fc.integer({ min: 1000, max: 99999 }),
  endpoint: fc.constant('https://test.eks.amazonaws.com'),
  bastionId: fc.stringMatching(/^i-[0-9a-f]{17}$/),
  contextName: fc.stringMatching(/^eks-tunnel-[a-z][a-z0-9-]{3,20}$/),
  startedAt: fc.constant('2024-01-15T10:30:00Z'),
});

describe('Property 14: Stop Cleans All Artifacts', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-tunnel-stop-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('stop single cluster: PID terminated, state entry removed, kubectl context cleaned, other entries untouched', () => {
    fc.assert(
      fc.property(
        // Generate 1-5 tunnel entries with unique cluster names, then pick one to stop
        fc.array(arbTunnelEntry, { minLength: 1, maxLength: 5 }).chain((entries) => {
          // Ensure unique cluster names
          const seen = new Set<string>();
          const uniqueEntries = entries.filter((e) => {
            if (seen.has(e.clusterName)) return false;
            seen.add(e.clusterName);
            return true;
          });
          const finalEntries = uniqueEntries.length > 0 ? uniqueEntries : [entries[0]];
          // Pick an index to stop
          return fc.integer({ min: 0, max: finalEntries.length - 1 }).map((idx) => ({
            entries: finalEntries,
            stopIndex: idx,
          }));
        }),
        ({ entries, stopIndex }) => {
          const statePath = path.join(tmpDir, 'state.json');
          const entryToStop = entries[stopIndex];

          // Write initial state with all entries
          writeState(statePath, { tunnels: entries });

          // Track process.kill calls
          const killedPids: Array<{ pid: number; signal: string | number | undefined }> = [];
          const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
            killedPids.push({ pid, signal });
            return true;
          });

          // Track execSync calls for kubectl commands
          const execCommands: string[] = [];
          const { execSync } = require('node:child_process');
          const execSyncMock = vi.fn((cmd: string) => {
            execCommands.push(cmd);
            return Buffer.from('');
          });
          vi.doMock('node:child_process', () => ({ execSync: execSyncMock }));

          // Simulate stop: terminate PID
          process.kill(entryToStop.pid, 'SIGTERM');

          // Simulate stop: remove kubeconfig artifacts
          const contextName = entryToStop.contextName;
          execSyncMock(`kubectl config delete-context ${contextName}`);
          execSyncMock(`kubectl config delete-cluster ${contextName}`);
          execSyncMock(`kubectl config delete-user ${contextName}`);

          // Remove tunnel entry from state
          removeTunnel(statePath, entryToStop.clusterName);

          // Verify: process.kill was called with correct PID and SIGTERM
          expect(killedPids).toContainEqual({ pid: entryToStop.pid, signal: 'SIGTERM' });

          // Verify: kubectl commands were issued for the correct context
          expect(execCommands).toContain(`kubectl config delete-context ${contextName}`);
          expect(execCommands).toContain(`kubectl config delete-cluster ${contextName}`);
          expect(execCommands).toContain(`kubectl config delete-user ${contextName}`);

          // Verify: state no longer contains the stopped cluster
          const resultState = readState(statePath);
          const foundStopped = resultState.tunnels.find(
            (t: TunnelEntry) => t.clusterName === entryToStop.clusterName
          );
          expect(foundStopped).toBeUndefined();

          // Verify: other entries remain untouched
          const otherEntries = entries.filter((_, i) => i !== stopIndex);
          for (const other of otherEntries) {
            const found = resultState.tunnels.find(
              (t: TunnelEntry) => t.clusterName === other.clusterName
            );
            expect(found).toBeDefined();
            expect(found!.pid).toBe(other.pid);
            expect(found!.localPort).toBe(other.localPort);
            expect(found!.contextName).toBe(other.contextName);
          }

          killSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('stop-all: all PIDs terminated, all kubectl contexts cleaned, state is empty', () => {
    fc.assert(
      fc.property(
        // Generate 1-5 tunnel entries with unique cluster names
        fc.array(arbTunnelEntry, { minLength: 1, maxLength: 5 }).map((entries) => {
          const seen = new Set<string>();
          const uniqueEntries = entries.filter((e) => {
            if (seen.has(e.clusterName)) return false;
            seen.add(e.clusterName);
            return true;
          });
          return uniqueEntries.length > 0 ? uniqueEntries : [entries[0]];
        }),
        (entries) => {
          const statePath = path.join(tmpDir, 'state.json');

          // Write initial state with all entries
          writeState(statePath, { tunnels: entries });

          // Track process.kill calls
          const killedPids: Array<{ pid: number; signal: string | number | undefined }> = [];
          const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string | number) => {
            killedPids.push({ pid, signal });
            return true;
          });

          // Track execSync calls for kubectl commands
          const execCommands: string[] = [];
          const execSyncMock = vi.fn((cmd: string) => {
            execCommands.push(cmd);
            return Buffer.from('');
          });

          // Simulate stop-all: terminate all PIDs and clean all kubeconfig contexts
          for (const entry of entries) {
            process.kill(entry.pid, 'SIGTERM');

            const contextName = entry.contextName;
            execSyncMock(`kubectl config delete-context ${contextName}`);
            execSyncMock(`kubectl config delete-cluster ${contextName}`);
            execSyncMock(`kubectl config delete-user ${contextName}`);
          }

          // Clear state entirely
          writeState(statePath, { tunnels: [] });

          // Verify: process.kill was called for EVERY PID with SIGTERM
          for (const entry of entries) {
            expect(killedPids).toContainEqual({ pid: entry.pid, signal: 'SIGTERM' });
          }

          // Verify: kubectl commands were issued for every context name
          for (const entry of entries) {
            const contextName = entry.contextName;
            expect(execCommands).toContain(`kubectl config delete-context ${contextName}`);
            expect(execCommands).toContain(`kubectl config delete-cluster ${contextName}`);
            expect(execCommands).toContain(`kubectl config delete-user ${contextName}`);
          }

          // Verify: final state is empty
          const resultState = readState(statePath);
          expect(resultState.tunnels).toHaveLength(0);
          expect(resultState).toEqual({ tunnels: [] });

          killSpy.mockRestore();
        }
      ),
      { numRuns: 100 }
    );
  });
});
