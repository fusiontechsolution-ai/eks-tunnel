import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readState, writeState, addTunnel, removeTunnel, cleanStaleTunnels } from '../../src/modules/state-manager';
import { TunnelEntry, TunnelState } from '../../src/types';

function makeTunnelEntry(overrides: Partial<TunnelEntry> = {}): TunnelEntry {
  return {
    clusterName: 'eu-west-1-my-cluster',
    accountName: 'production',
    accountId: '123456789012',
    profile: 'prod-profile',
    region: 'eu-west-1',
    localPort: 8443,
    pid: process.pid, // Use current process PID so it's always alive
    endpoint: 'https://ABCDEF.gr7.eu-west-1.eks.amazonaws.com',
    bastionId: 'i-0abc123def456',
    contextName: 'eks-tunnel-eu-west-1-my-cluster',
    startedAt: '2024-01-15T10:30:00Z',
    ...overrides,
  };
}

describe('StateManager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-manager-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('readState', () => {
    it('returns empty state when file does not exist', () => {
      const statePath = path.join(tmpDir, 'nonexistent.json');
      const state = readState(statePath);
      expect(state).toEqual({ tunnels: [] });
    });

    it('returns empty state and logs warning on corrupted JSON', () => {
      const statePath = path.join(tmpDir, 'corrupted.json');
      fs.writeFileSync(statePath, 'not valid json {{{');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const state = readState(statePath);

      expect(state).toEqual({ tunnels: [] });
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('corrupted')
      );
      warnSpy.mockRestore();
    });

    it('parses a valid state file', () => {
      const statePath = path.join(tmpDir, 'state.json');
      const entry = makeTunnelEntry();
      fs.writeFileSync(statePath, JSON.stringify({ tunnels: [entry] }));

      const state = readState(statePath);

      expect(state.tunnels).toHaveLength(1);
      expect(state.tunnels[0].clusterName).toBe('eu-west-1-my-cluster');
      expect(state.tunnels[0].localPort).toBe(8443);
    });

    it('resolves ~ to home directory', () => {
      // Use a path that definitely doesn't exist under home
      const state = readState('~/.eks-tunnel-test-nonexistent-xyz/state.json');
      expect(state).toEqual({ tunnels: [] });
    });
  });

  describe('writeState', () => {
    it('writes state as formatted JSON', () => {
      const statePath = path.join(tmpDir, 'state.json');
      const entry = makeTunnelEntry();
      const state: TunnelState = { tunnels: [entry] };

      writeState(statePath, state);

      const content = fs.readFileSync(statePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.tunnels).toHaveLength(1);
      expect(parsed.tunnels[0].clusterName).toBe('eu-west-1-my-cluster');
      // Check it's formatted with 2-space indent
      expect(content).toContain('  ');
    });

    it('creates parent directories if they do not exist', () => {
      const statePath = path.join(tmpDir, 'nested', 'deep', 'state.json');
      const state: TunnelState = { tunnels: [] };

      writeState(statePath, state);

      expect(fs.existsSync(statePath)).toBe(true);
    });

    it('overwrites existing state file', () => {
      const statePath = path.join(tmpDir, 'state.json');
      writeState(statePath, { tunnels: [makeTunnelEntry()] });
      writeState(statePath, { tunnels: [] });

      const state = readState(statePath);
      expect(state.tunnels).toHaveLength(0);
    });
  });

  describe('addTunnel', () => {
    it('adds an entry to an empty state', () => {
      const statePath = path.join(tmpDir, 'state.json');
      const entry = makeTunnelEntry();

      addTunnel(statePath, entry);

      const state = readState(statePath);
      expect(state.tunnels).toHaveLength(1);
      expect(state.tunnels[0].clusterName).toBe('eu-west-1-my-cluster');
    });

    it('appends to existing entries', () => {
      const statePath = path.join(tmpDir, 'state.json');
      const entry1 = makeTunnelEntry({ clusterName: 'cluster-1', localPort: 8443 });
      const entry2 = makeTunnelEntry({ clusterName: 'cluster-2', localPort: 8444 });

      addTunnel(statePath, entry1);
      addTunnel(statePath, entry2);

      const state = readState(statePath);
      expect(state.tunnels).toHaveLength(2);
      expect(state.tunnels[0].clusterName).toBe('cluster-1');
      expect(state.tunnels[1].clusterName).toBe('cluster-2');
    });
  });

  describe('removeTunnel', () => {
    it('removes the entry matching cluster name', () => {
      const statePath = path.join(tmpDir, 'state.json');
      const entry1 = makeTunnelEntry({ clusterName: 'cluster-1' });
      const entry2 = makeTunnelEntry({ clusterName: 'cluster-2' });
      writeState(statePath, { tunnels: [entry1, entry2] });

      removeTunnel(statePath, 'cluster-1');

      const state = readState(statePath);
      expect(state.tunnels).toHaveLength(1);
      expect(state.tunnels[0].clusterName).toBe('cluster-2');
    });

    it('does nothing when cluster name is not found', () => {
      const statePath = path.join(tmpDir, 'state.json');
      const entry = makeTunnelEntry({ clusterName: 'cluster-1' });
      writeState(statePath, { tunnels: [entry] });

      removeTunnel(statePath, 'nonexistent');

      const state = readState(statePath);
      expect(state.tunnels).toHaveLength(1);
    });
  });

  describe('cleanStaleTunnels', () => {
    it('keeps entries with live PIDs', () => {
      const statePath = path.join(tmpDir, 'state.json');
      // Use the current process PID which is definitely alive
      const entry = makeTunnelEntry({ pid: process.pid });
      writeState(statePath, { tunnels: [entry] });

      const removed = cleanStaleTunnels(statePath);

      expect(removed).toHaveLength(0);
      const state = readState(statePath);
      expect(state.tunnels).toHaveLength(1);
    });

    it('removes entries with dead PIDs', () => {
      const statePath = path.join(tmpDir, 'state.json');
      // Use a PID that almost certainly doesn't exist
      const entry = makeTunnelEntry({ pid: 99999999 });
      writeState(statePath, { tunnels: [entry] });

      const removed = cleanStaleTunnels(statePath);

      expect(removed).toHaveLength(1);
      expect(removed[0].pid).toBe(99999999);
      const state = readState(statePath);
      expect(state.tunnels).toHaveLength(0);
    });

    it('separates live and stale entries correctly', () => {
      const statePath = path.join(tmpDir, 'state.json');
      const liveEntry = makeTunnelEntry({ clusterName: 'live', pid: process.pid });
      const staleEntry = makeTunnelEntry({ clusterName: 'stale', pid: 99999999 });
      writeState(statePath, { tunnels: [liveEntry, staleEntry] });

      const removed = cleanStaleTunnels(statePath);

      expect(removed).toHaveLength(1);
      expect(removed[0].clusterName).toBe('stale');
      const state = readState(statePath);
      expect(state.tunnels).toHaveLength(1);
      expect(state.tunnels[0].clusterName).toBe('live');
    });

    it('returns empty array when no tunnels exist', () => {
      const statePath = path.join(tmpDir, 'state.json');
      writeState(statePath, { tunnels: [] });

      const removed = cleanStaleTunnels(statePath);

      expect(removed).toHaveLength(0);
    });
  });
});
