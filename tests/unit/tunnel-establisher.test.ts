import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExitError } from '../../src/errors.js';
import { EXIT_CODES } from '../../src/constants.js';
import type { ChildProcess } from 'child_process';
import type { Socket } from 'net';

// Mock child_process and net at the top level
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('net', () => ({
  createConnection: vi.fn(),
}));

import { spawn } from 'child_process';
import { createConnection } from 'net';
import { establishTunnel } from '../../src/modules/tunnel-establisher.js';

const mockSpawn = vi.mocked(spawn);
const mockCreateConnection = vi.mocked(createConnection);

describe('TunnelEstablisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockChildProcess(pid: number = 12345) {
    const child = {
      pid,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      unref: vi.fn(),
    } as unknown as ChildProcess;
    return child;
  }

  /**
   * Configure mockCreateConnection to immediately call the connect callback,
   * simulating a port that is ready.
   */
  function setupPortReady() {
    mockCreateConnection.mockImplementation((...args: any[]) => {
      const connectCb = args[1] as (() => void) | undefined;
      const socket = {
        destroy: vi.fn(),
        on: vi.fn(),
        setTimeout: vi.fn(),
      } as unknown as Socket;
      if (connectCb) {
        process.nextTick(connectCb);
      }
      return socket;
    });
  }

  /**
   * Configure mockCreateConnection to emit an error,
   * simulating a port that is NOT ready.
   */
  function setupPortNotReady() {
    mockCreateConnection.mockImplementation((...args: any[]) => {
      const socket = {
        destroy: vi.fn(),
        on: vi.fn((event: string, cb: (err: Error) => void) => {
          if (event === 'error') {
            process.nextTick(() => cb(new Error('ECONNREFUSED')));
          }
          return socket;
        }),
        setTimeout: vi.fn(),
      } as unknown as Socket;
      return socket;
    });
  }

  describe('establishTunnel', () => {
    it('constructs the correct SSM command arguments', async () => {
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);
      setupPortReady();

      // Don't fire spawn error
      (child.on as ReturnType<typeof vi.fn>).mockImplementation(() => child);

      await establishTunnel(
        'i-0abc123def456',
        'ABCDEF.gr7.eu-west-1.eks.amazonaws.com',
        8443,
        'my-profile',
        'eu-west-1'
      );

      expect(mockSpawn).toHaveBeenCalledWith(
        'aws',
        [
          'ssm',
          'start-session',
          '--target', 'i-0abc123def456',
          '--document-name', 'AWS-StartPortForwardingSessionToRemoteHost',
          '--parameters', 'host=ABCDEF.gr7.eu-west-1.eks.amazonaws.com,portNumber=443,localPortNumber=8443',
          '--profile', 'my-profile',
          '--region', 'eu-west-1',
        ],
        {
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
    });

    it('returns pid and localPort on successful tunnel establishment', async () => {
      const child = createMockChildProcess(99999);
      mockSpawn.mockReturnValue(child);
      setupPortReady();
      (child.on as ReturnType<typeof vi.fn>).mockImplementation(() => child);

      const result = await establishTunnel(
        'i-0abc123def456',
        'example.eks.amazonaws.com',
        9000,
        'test-profile',
        'us-east-1'
      );

      expect(result).toEqual({ pid: 99999, localPort: 9000 });
    });

    it('unrefs the child process on success so CLI can exit', async () => {
      const child = createMockChildProcess(12345);
      mockSpawn.mockReturnValue(child);
      setupPortReady();
      (child.on as ReturnType<typeof vi.fn>).mockImplementation(() => child);

      await establishTunnel(
        'i-0test123',
        'host.eks.amazonaws.com',
        8443,
        'prof',
        'us-west-2'
      );

      expect(child.unref).toHaveBeenCalledTimes(1);
    });

    it('throws ExitError with code 4 when spawn emits an error', async () => {
      const child = createMockChildProcess(undefined as unknown as number);
      mockSpawn.mockReturnValue(child);
      setupPortNotReady();

      // Simulate spawn error event firing immediately
      (child.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, cb: (err: Error) => void) => {
        if (event === 'error') {
          process.nextTick(() => cb(new Error('spawn aws ENOENT')));
        }
        return child;
      });

      try {
        await establishTunnel(
          'i-0abc123def456',
          'example.eks.amazonaws.com',
          8443,
          'test-profile',
          'us-east-1'
        );
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ExitError);
        const exitErr = err as ExitError;
        expect(exitErr.exitCode).toBe(EXIT_CODES.TUNNEL_TIMEOUT);
        expect(exitErr.message).toContain('Failed to spawn SSM session');
        expect(exitErr.message).toContain('ENOENT');
      }
    });

    it('throws ExitError with code 4 on poll timeout', async () => {
      const child = createMockChildProcess(54321);
      mockSpawn.mockReturnValue(child);
      setupPortNotReady();
      (child.on as ReturnType<typeof vi.fn>).mockImplementation(() => child);

      // Mock process.kill to prevent actually killing anything
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

      try {
        await establishTunnel(
          'i-0abc123def456',
          'example.eks.amazonaws.com',
          8443,
          'test-profile',
          'us-east-1'
        );
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ExitError);
        const exitErr = err as ExitError;
        expect(exitErr.exitCode).toBe(EXIT_CODES.TUNNEL_TIMEOUT);
        expect(exitErr.message).toContain('did not become ready');
        expect(exitErr.suggestions).toBeDefined();
        expect(exitErr.suggestions!.length).toBeGreaterThan(0);
      }

      // Should have tried to kill the process group
      expect(killSpy).toHaveBeenCalledWith(-54321, 'SIGTERM');

      killSpy.mockRestore();
    }, 15_000);

    it('spawns with detached true and correct stdio configuration', async () => {
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);
      setupPortReady();
      (child.on as ReturnType<typeof vi.fn>).mockImplementation(() => child);

      await establishTunnel(
        'i-0test123',
        'host.eks.amazonaws.com',
        8443,
        'prof',
        'us-west-2'
      );

      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[2]).toEqual({
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    });
  });
});
