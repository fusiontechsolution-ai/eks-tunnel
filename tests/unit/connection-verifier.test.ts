import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExitError } from '../../src/errors.js';
import { EXIT_CODES } from '../../src/constants.js';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import { verifyConnection } from '../../src/modules/connection-verifier.js';

const mockExecSync = vi.mocked(execSync);

describe('ConnectionVerifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('verifyConnection', () => {
    it('executes kubectl with the correct context and timeout', async () => {
      mockExecSync.mockReturnValue(
        'NAME          STATUS   ROLES    AGE   VERSION\nnode-1        Ready    <none>   5d    v1.28.0\n'
      );

      await verifyConnection('eks-tunnel-my-cluster');

      expect(mockExecSync).toHaveBeenCalledWith(
        'kubectl get nodes --context eks-tunnel-my-cluster --request-timeout=10s',
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
    });

    it('returns success with correct node count for single node', async () => {
      mockExecSync.mockReturnValue(
        'NAME          STATUS   ROLES    AGE   VERSION\nnode-1        Ready    <none>   5d    v1.28.0\n'
      );

      const result = await verifyConnection('eks-tunnel-my-cluster');

      expect(result).toEqual({ success: true, nodeCount: 1 });
    });

    it('returns success with correct node count for multiple nodes', async () => {
      mockExecSync.mockReturnValue(
        'NAME          STATUS   ROLES    AGE   VERSION\n' +
        'node-1        Ready    <none>   5d    v1.28.0\n' +
        'node-2        Ready    <none>   5d    v1.28.0\n' +
        'node-3        Ready    <none>   3d    v1.28.0\n'
      );

      const result = await verifyConnection('eks-tunnel-prod');

      expect(result).toEqual({ success: true, nodeCount: 3 });
    });

    it('returns nodeCount 0 when output only has a header', async () => {
      mockExecSync.mockReturnValue(
        'NAME          STATUS   ROLES    AGE   VERSION\n'
      );

      const result = await verifyConnection('eks-tunnel-empty');

      expect(result).toEqual({ success: true, nodeCount: 0 });
    });

    it('throws ExitError with exit code 5 on kubectl failure', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Unable to connect to the server: dial tcp 127.0.0.1:8443: connect: connection refused');
      });

      try {
        await verifyConnection('eks-tunnel-failing');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ExitError);
        const exitErr = err as ExitError;
        expect(exitErr.exitCode).toBe(EXIT_CODES.VERIFY_FAILED);
        expect(exitErr.message).toContain('connection refused');
      }
    });

    it('includes suggestions in the thrown ExitError', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('connection timed out');
      });

      try {
        await verifyConnection('eks-tunnel-timeout');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ExitError);
        const exitErr = err as ExitError;
        expect(exitErr.suggestions).toBeDefined();
        expect(exitErr.suggestions).toContain('Check that the SSM tunnel is still active');
        expect(exitErr.suggestions).toContain('Verify your AWS credentials are valid');
        expect(exitErr.suggestions).toContain("Try running 'eks-tunnel status' to check tunnel health");
      }
    });

    it('handles non-Error thrown objects gracefully', async () => {
      mockExecSync.mockImplementation(() => {
        throw 'unexpected string error';
      });

      try {
        await verifyConnection('eks-tunnel-weird');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ExitError);
        const exitErr = err as ExitError;
        expect(exitErr.exitCode).toBe(EXIT_CODES.VERIFY_FAILED);
        expect(exitErr.message).toBe('Connection verification failed');
      }
    });
  });
});
