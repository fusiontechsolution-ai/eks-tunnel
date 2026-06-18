import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'child_process';
import { configureKubeconfig } from '../../src/modules/kubeconfig-configurator.js';

const mockExecSync = vi.mocked(execSync);

describe('KubeconfigConfigurator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configureKubeconfig', () => {
    it('returns the correct context name based on cluster name', async () => {
      const result = await configureKubeconfig(
        'eu-west-1-my-cluster',
        8443,
        'my-profile',
        'eu-west-1'
      );

      expect(result).toEqual({ contextName: 'eks-tunnel-eu-west-1-my-cluster' });
    });

    it('sets the cluster entry with correct server and insecure-skip-tls-verify', async () => {
      await configureKubeconfig('us-east-1-prod', 9000, 'prod-profile', 'us-east-1');

      expect(mockExecSync).toHaveBeenCalledWith(
        'kubectl config set-cluster eks-tunnel-us-east-1-prod --server=https://localhost:9000 --insecure-skip-tls-verify=true',
        { stdio: 'pipe' }
      );
    });

    it('sets user credentials with exec-based token retrieval', async () => {
      await configureKubeconfig('eu-west-2-staging', 8444, 'staging-profile', 'eu-west-2');

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('kubectl config set-credentials eks-tunnel-eu-west-2-staging'),
        { stdio: 'pipe' }
      );

      const credentialsCall = mockExecSync.mock.calls.find(
        (call) => (call[0] as string).includes('set-credentials')
      );
      const cmd = credentialsCall![0] as string;

      expect(cmd).toContain('--exec-api-version=client.authentication.k8s.io/v1beta1');
      expect(cmd).toContain('--exec-command=aws');
      expect(cmd).toContain('--exec-arg=eks');
      expect(cmd).toContain('--exec-arg=get-token');
      expect(cmd).toContain('--exec-arg=--cluster-name');
      expect(cmd).toContain('--exec-arg=eu-west-2-staging');
      expect(cmd).toContain('--exec-arg=--profile');
      expect(cmd).toContain('--exec-arg=staging-profile');
      expect(cmd).toContain('--exec-arg=--region');
      expect(cmd).toContain('--exec-arg=eu-west-2');
    });

    it('sets the context linking cluster and user entries', async () => {
      await configureKubeconfig('ap-southeast-2-app', 8500, 'ap-profile', 'ap-southeast-2');

      expect(mockExecSync).toHaveBeenCalledWith(
        'kubectl config set-context eks-tunnel-ap-southeast-2-app --cluster=eks-tunnel-ap-southeast-2-app --user=eks-tunnel-ap-southeast-2-app',
        { stdio: 'pipe' }
      );
    });

    it('sets the current context to the new context', async () => {
      await configureKubeconfig('us-west-2-dev', 8443, 'dev-profile', 'us-west-2');

      expect(mockExecSync).toHaveBeenCalledWith(
        'kubectl config use-context eks-tunnel-us-west-2-dev',
        { stdio: 'pipe' }
      );
    });

    it('executes commands in the correct order', async () => {
      await configureKubeconfig('eu-central-1-test', 8443, 'test-profile', 'eu-central-1');

      expect(mockExecSync).toHaveBeenCalledTimes(4);

      const calls = mockExecSync.mock.calls.map((call) => call[0] as string);

      // Order: set-cluster, set-credentials, set-context, use-context
      expect(calls[0]).toContain('set-cluster');
      expect(calls[1]).toContain('set-credentials');
      expect(calls[2]).toContain('set-context');
      expect(calls[3]).toContain('use-context');
    });

    it('handles cluster names with multiple hyphens correctly', async () => {
      const result = await configureKubeconfig(
        'eu-west-1-my-complex-cluster-name',
        8443,
        'my-profile',
        'eu-west-1'
      );

      expect(result.contextName).toBe('eks-tunnel-eu-west-1-my-complex-cluster-name');

      const calls = mockExecSync.mock.calls.map((call) => call[0] as string);
      expect(calls[0]).toContain('eks-tunnel-eu-west-1-my-complex-cluster-name');
      expect(calls[3]).toContain('eks-tunnel-eu-west-1-my-complex-cluster-name');
    });
  });
});
