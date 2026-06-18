import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

/**
 * Property tests for kubeconfig generation correctness and idempotence.
 * Validates: Requirements 10.1, 10.2, 10.3, 10.5
 */

// Mock child_process before importing the module
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import { configureKubeconfig } from '../../src/modules/kubeconfig-configurator.js';

const mockedExecSync = vi.mocked(execSync);

// ---------- Custom Arbitraries ----------

const arbClusterName = fc.tuple(
  fc.constantFrom('us-east-1', 'eu-west-1', 'ap-southeast-2'),
  fc.stringMatching(/^[a-z][a-z0-9-]{2,15}$/)
).map(([region, suffix]) => `${region}-${suffix}`);

const arbPort = fc.integer({ min: 8443, max: 65535 });

const arbProfile = fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/);

const arbRegion = fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-central-1');

// ---------- Property 11: Kubeconfig Generation Correctness ----------

describe('Property 11: Kubeconfig Generation Correctness', () => {
  /**
   * Validates: Requirements 10.1, 10.2, 10.3
   * For any cluster name, local port, profile, and region, the kubeconfig configurator
   * SHALL produce: a cluster entry with server https://localhost:{port} and
   * insecure-skip-tls-verify true, a user entry with exec command aws and args
   * [eks, get-token, --cluster-name, {cluster}, --profile, {profile}, --region, {region}],
   * and a context named eks-tunnel-{cluster-name} linking both.
   */

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('first call sets cluster with correct server and insecure-skip-tls-verify', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClusterName,
        arbPort,
        arbProfile,
        arbRegion,
        async (clusterName, port, profile, region) => {
          mockedExecSync.mockReset();
          mockedExecSync.mockReturnValue('' as any);

          await configureKubeconfig(clusterName, port, profile, region);

          const firstCall = mockedExecSync.mock.calls[0][0] as string;
          expect(firstCall).toContain(`set-cluster eks-tunnel-${clusterName}`);
          expect(firstCall).toContain(`--server=https://localhost:${port}`);
          expect(firstCall).toContain('--insecure-skip-tls-verify=true');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('second call sets credentials with correct exec args for aws eks get-token', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClusterName,
        arbPort,
        arbProfile,
        arbRegion,
        async (clusterName, port, profile, region) => {
          mockedExecSync.mockReset();
          mockedExecSync.mockReturnValue('' as any);

          await configureKubeconfig(clusterName, port, profile, region);

          const secondCall = mockedExecSync.mock.calls[1][0] as string;
          expect(secondCall).toContain(`set-credentials eks-tunnel-${clusterName}`);
          expect(secondCall).toContain('--exec-arg=eks');
          expect(secondCall).toContain('--exec-arg=get-token');
          expect(secondCall).toContain('--exec-arg=--cluster-name');
          expect(secondCall).toContain(`--exec-arg=${clusterName}`);
          expect(secondCall).toContain('--exec-arg=--profile');
          expect(secondCall).toContain(`--exec-arg=${profile}`);
          expect(secondCall).toContain('--exec-arg=--region');
          expect(secondCall).toContain(`--exec-arg=${region}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('third call sets context linking cluster and user entries', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClusterName,
        arbPort,
        arbProfile,
        arbRegion,
        async (clusterName, port, profile, region) => {
          mockedExecSync.mockReset();
          mockedExecSync.mockReturnValue('' as any);

          await configureKubeconfig(clusterName, port, profile, region);

          const thirdCall = mockedExecSync.mock.calls[2][0] as string;
          expect(thirdCall).toContain(`set-context eks-tunnel-${clusterName}`);
          expect(thirdCall).toContain(`--cluster=eks-tunnel-${clusterName}`);
          expect(thirdCall).toContain(`--user=eks-tunnel-${clusterName}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns contextName as eks-tunnel-{clusterName}', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClusterName,
        arbPort,
        arbProfile,
        arbRegion,
        async (clusterName, port, profile, region) => {
          mockedExecSync.mockReset();
          mockedExecSync.mockReturnValue('' as any);

          const result = await configureKubeconfig(clusterName, port, profile, region);

          expect(result.contextName).toBe(`eks-tunnel-${clusterName}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------- Property 12: Kubeconfig Idempotence ----------

describe('Property 12: Kubeconfig Idempotence', () => {
  /**
   * Validates: Requirements 10.5
   * For any cluster configuration parameters, running configureKubeconfig twice with
   * the same parameters SHALL produce the same kubectl commands both times (no different
   * behavior on second call). Since kubectl config set is inherently idempotent, we verify
   * the module calls the same commands regardless of whether it's a first-time or repeat call.
   */

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calling configureKubeconfig twice issues identical commands both times', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClusterName,
        arbPort,
        arbProfile,
        arbRegion,
        async (clusterName, port, profile, region) => {
          mockedExecSync.mockReset();
          mockedExecSync.mockReturnValue('' as any);

          // First call
          await configureKubeconfig(clusterName, port, profile, region);
          const firstRunCalls = [...mockedExecSync.mock.calls.map(c => c[0])];

          // Reset mock call history only (keep implementation)
          mockedExecSync.mockClear();
          mockedExecSync.mockReturnValue('' as any);

          // Second call with same params
          await configureKubeconfig(clusterName, port, profile, region);
          const secondRunCalls = mockedExecSync.mock.calls.map(c => c[0]);

          // Both runs should produce exactly the same commands
          expect(firstRunCalls).toEqual(secondRunCalls);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('second call produces same contextName as first call', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClusterName,
        arbPort,
        arbProfile,
        arbRegion,
        async (clusterName, port, profile, region) => {
          mockedExecSync.mockReset();
          mockedExecSync.mockReturnValue('' as any);

          const result1 = await configureKubeconfig(clusterName, port, profile, region);
          const result2 = await configureKubeconfig(clusterName, port, profile, region);

          expect(result1.contextName).toBe(result2.contextName);
        }
      ),
      { numRuns: 100 }
    );
  });
});
