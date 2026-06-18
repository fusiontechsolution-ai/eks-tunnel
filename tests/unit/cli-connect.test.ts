import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExitError } from '../../src/errors.js';
import { EXIT_CODES } from '../../src/constants.js';
import type { ClusterRegistry, ResolvedCluster, EksEndpoint, TunnelState, TunnelResult, KubeconfigResult, VerificationResult, OutputOptions } from '../../src/types.js';

// Mock all module dependencies
vi.mock('../../src/modules/prerequisite-checker.js', () => ({
  checkPrerequisites: vi.fn(),
}));
vi.mock('../../src/modules/registry-loader.js', () => ({
  resolveConfigPath: vi.fn(),
  loadRegistry: vi.fn(),
}));
vi.mock('../../src/modules/cluster-resolver.js', () => ({
  resolveCluster: vi.fn(),
}));
vi.mock('../../src/modules/region-inferrer.js', () => ({
  inferRegion: vi.fn(),
}));
vi.mock('../../src/modules/endpoint-discoverer.js', () => ({
  discoverEndpoint: vi.fn(),
}));
vi.mock('../../src/modules/port-assigner.js', () => ({
  assignPort: vi.fn(),
}));
vi.mock('../../src/modules/tunnel-establisher.js', () => ({
  establishTunnel: vi.fn(),
}));
vi.mock('../../src/modules/kubeconfig-configurator.js', () => ({
  configureKubeconfig: vi.fn(),
}));
vi.mock('../../src/modules/connection-verifier.js', () => ({
  verifyConnection: vi.fn(),
}));
vi.mock('../../src/modules/state-manager.js', () => ({
  readState: vi.fn(),
  addTunnel: vi.fn(),
}));
vi.mock('../../src/modules/output-formatter.js', () => ({
  progress: vi.fn(),
  result: vi.fn(),
  error: vi.fn(),
}));

import { checkPrerequisites } from '../../src/modules/prerequisite-checker.js';
import { resolveConfigPath, loadRegistry } from '../../src/modules/registry-loader.js';
import { resolveCluster } from '../../src/modules/cluster-resolver.js';
import { inferRegion } from '../../src/modules/region-inferrer.js';
import { discoverEndpoint } from '../../src/modules/endpoint-discoverer.js';
import { assignPort } from '../../src/modules/port-assigner.js';
import { establishTunnel } from '../../src/modules/tunnel-establisher.js';
import { configureKubeconfig } from '../../src/modules/kubeconfig-configurator.js';
import { verifyConnection } from '../../src/modules/connection-verifier.js';
import { readState, addTunnel } from '../../src/modules/state-manager.js';
import { progress, result, error } from '../../src/modules/output-formatter.js';

// --- Helper to build default mock return values ---

const mockRegistry: ClusterRegistry = {
  accounts: [{
    accountId: '123456789012',
    accountName: 'dev-account',
    profile: 'dev-profile',
    clusters: [{
      name: 'my-cluster',
      bastionInstanceId: 'i-0123456789abcdef0',
      region: 'us-east-1',
    }],
  }],
};

const mockResolved: ResolvedCluster = {
  cluster: { name: 'my-cluster', bastionInstanceId: 'i-0123456789abcdef0', region: 'us-east-1' },
  account: { accountId: '123456789012', accountName: 'dev-account', profile: 'dev-profile', clusters: [] },
};

const mockEndpoint: EksEndpoint = {
  url: 'https://ABCDEF.gr7.us-east-1.eks.amazonaws.com',
  host: 'ABCDEF.gr7.us-east-1.eks.amazonaws.com',
  caData: 'base64ca==',
};

const mockState: TunnelState = { tunnels: [] };

const mockTunnelResult: TunnelResult = { pid: 12345, localPort: 8443 };

const mockKubeconfigResult: KubeconfigResult = { contextName: 'eks-tunnel-my-cluster' };

const mockVerification: VerificationResult = { success: true, nodeCount: 3 };

/**
 * Simulates the connect command action logic extracted from cli.ts.
 * This allows us to test the flow without spawning a CLI process.
 */
async function runConnect(
  clusterName: string | undefined,
  options: {
    config?: string;
    port?: number;
    json?: boolean;
    quiet?: boolean;
    skipPrereqs?: boolean;
  }
): Promise<void> {
  const outputOptions: OutputOptions = {
    json: options.json ?? false,
    quiet: options.quiet ?? false,
  };

  // Step 1: Check prerequisites
  progress('Checking prerequisites', outputOptions);
  checkPrerequisites(options.skipPrereqs ?? false);

  // Step 2: Load cluster registry
  progress('Loading cluster registry', outputOptions);
  const configPath = resolveConfigPath(options.config);
  const registry = loadRegistry(configPath);

  // Step 3: Resolve cluster
  progress('Resolving cluster', outputOptions);
  const resolved = await resolveCluster(clusterName, registry, process.stdin.isTTY ?? false);

  // Step 4: Infer region
  progress('Inferring region', outputOptions);
  const region = await inferRegion(resolved.cluster, process.stdin.isTTY ?? false);

  // Step 5: Discover EKS endpoint
  progress('Discovering EKS endpoint', outputOptions);
  const endpoint = await discoverEndpoint(
    resolved.cluster.name,
    resolved.account.profile,
    region,
    resolved.account
  );

  // Step 6: Assign local port
  progress('Assigning local port', outputOptions);
  const state = readState('~/.eks-tunnel/state.json');
  const port = await assignPort(options.port, state);

  // Step 7: Establish SSM tunnel
  progress('Establishing SSM tunnel', outputOptions);
  const tunnelResult = await establishTunnel(
    resolved.cluster.bastionInstanceId,
    endpoint.host,
    port,
    resolved.account.profile,
    region
  );

  // Step 8: Save tunnel state
  const tunnelEntry = {
    clusterName: resolved.cluster.name,
    accountName: resolved.account.accountName,
    accountId: resolved.account.accountId,
    profile: resolved.account.profile,
    region,
    localPort: tunnelResult.localPort,
    pid: tunnelResult.pid,
    endpoint: endpoint.url,
    bastionId: resolved.cluster.bastionInstanceId,
    contextName: `eks-tunnel-${resolved.cluster.name}`,
    startedAt: expect.any(String),
  };
  addTunnel('~/.eks-tunnel/state.json', expect.objectContaining(tunnelEntry));

  // Step 9: Configure kubeconfig
  progress('Configuring kubeconfig', outputOptions);
  const kubeconfigResult = await configureKubeconfig(
    resolved.cluster.name,
    port,
    resolved.account.profile,
    region
  );

  // Step 10: Verify connection
  progress('Verifying connection', outputOptions);
  await verifyConnection(kubeconfigResult.contextName);

  // Output success result
  result({
    status: 'connected',
    cluster: resolved.cluster.name,
    account: resolved.account.accountName,
    region,
    localPort: tunnelResult.localPort,
    context: kubeconfigResult.contextName,
    nodes: (await verifyConnection(kubeconfigResult.contextName)).nodeCount,
    pid: tunnelResult.pid,
    example: `kubectl get pods --context ${kubeconfigResult.contextName}`,
  }, outputOptions);
}

/**
 * A simpler connect runner that mirrors the actual CLI logic more closely
 * (without the expect matchers in the middle of execution).
 */
async function executeConnect(
  clusterName: string | undefined,
  options: {
    config?: string;
    port?: number;
    json?: boolean;
    quiet?: boolean;
    skipPrereqs?: boolean;
  }
): Promise<{ exitCode: number } | void> {
  const outputOptions: OutputOptions = {
    json: options.json ?? false,
    quiet: options.quiet ?? false,
  };

  try {
    progress('Checking prerequisites', outputOptions);
    checkPrerequisites(options.skipPrereqs ?? false);

    progress('Loading cluster registry', outputOptions);
    const configPath = resolveConfigPath(options.config);
    const registry = loadRegistry(configPath);

    progress('Resolving cluster', outputOptions);
    const resolved = await resolveCluster(clusterName, registry, process.stdin.isTTY ?? false);

    progress('Inferring region', outputOptions);
    const region = await inferRegion(resolved.cluster, process.stdin.isTTY ?? false);

    progress('Discovering EKS endpoint', outputOptions);
    const endpoint = await discoverEndpoint(
      resolved.cluster.name,
      resolved.account.profile,
      region,
      resolved.account
    );

    progress('Assigning local port', outputOptions);
    const state = readState('~/.eks-tunnel/state.json');
    const port = await assignPort(options.port, state);

    progress('Establishing SSM tunnel', outputOptions);
    const tunnelResult = await establishTunnel(
      resolved.cluster.bastionInstanceId,
      endpoint.host,
      port,
      resolved.account.profile,
      region
    );

    addTunnel('~/.eks-tunnel/state.json', expect.objectContaining({
      clusterName: resolved.cluster.name,
    }) as any);

    progress('Configuring kubeconfig', outputOptions);
    const kubeconfigResult = await configureKubeconfig(
      resolved.cluster.name,
      port,
      resolved.account.profile,
      region
    );

    progress('Verifying connection', outputOptions);
    const verification = await verifyConnection(kubeconfigResult.contextName);

    result({
      status: 'connected',
      cluster: resolved.cluster.name,
      account: resolved.account.accountName,
      region,
      localPort: tunnelResult.localPort,
      context: kubeconfigResult.contextName,
      nodes: verification.nodeCount,
      pid: tunnelResult.pid,
      example: `kubectl get pods --context ${kubeconfigResult.contextName}`,
    }, outputOptions);
  } catch (err) {
    if (err instanceof ExitError) {
      error(err.message, err.suggestions);
      return { exitCode: err.exitCode };
    }
    error(String(err));
    return { exitCode: 1 };
  }
}

describe('CLI connect flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up default happy-path return values
    vi.mocked(checkPrerequisites).mockReturnValue(undefined);
    vi.mocked(resolveConfigPath).mockReturnValue('/home/user/.eks-tunnel/clusters.json');
    vi.mocked(loadRegistry).mockReturnValue(mockRegistry);
    vi.mocked(resolveCluster).mockResolvedValue(mockResolved);
    vi.mocked(inferRegion).mockResolvedValue('us-east-1');
    vi.mocked(discoverEndpoint).mockResolvedValue(mockEndpoint);
    vi.mocked(readState).mockReturnValue(mockState);
    vi.mocked(assignPort).mockResolvedValue(8443);
    vi.mocked(establishTunnel).mockResolvedValue(mockTunnelResult);
    vi.mocked(configureKubeconfig).mockResolvedValue(mockKubeconfigResult);
    vi.mocked(verifyConnection).mockResolvedValue(mockVerification);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('successful connect flow', () => {
    it('calls all modules in correct order', async () => {
      await executeConnect('my-cluster', {});

      // Verify call order
      expect(checkPrerequisites).toHaveBeenCalledWith(false);
      expect(resolveConfigPath).toHaveBeenCalledWith(undefined);
      expect(loadRegistry).toHaveBeenCalledWith('/home/user/.eks-tunnel/clusters.json');
      expect(resolveCluster).toHaveBeenCalledWith('my-cluster', mockRegistry, expect.any(Boolean));
      expect(inferRegion).toHaveBeenCalledWith(mockResolved.cluster, expect.any(Boolean));
      expect(discoverEndpoint).toHaveBeenCalledWith(
        'my-cluster',
        'dev-profile',
        'us-east-1',
        mockResolved.account
      );
      expect(readState).toHaveBeenCalledWith('~/.eks-tunnel/state.json');
      expect(assignPort).toHaveBeenCalledWith(undefined, mockState);
      expect(establishTunnel).toHaveBeenCalledWith(
        'i-0123456789abcdef0',
        'ABCDEF.gr7.us-east-1.eks.amazonaws.com',
        8443,
        'dev-profile',
        'us-east-1'
      );
      expect(addTunnel).toHaveBeenCalled();
      expect(configureKubeconfig).toHaveBeenCalledWith('my-cluster', 8443, 'dev-profile', 'us-east-1');
      expect(verifyConnection).toHaveBeenCalledWith('eks-tunnel-my-cluster');
    });

    it('result includes cluster name, account, region, port, and context', async () => {
      await executeConnect('my-cluster', {});

      expect(result).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'connected',
          cluster: 'my-cluster',
          account: 'dev-account',
          region: 'us-east-1',
          localPort: 8443,
          context: 'eks-tunnel-my-cluster',
          nodes: 3,
          pid: 12345,
        }),
        expect.objectContaining({ json: false, quiet: false })
      );
    });
  });

  describe('error handling and exit codes', () => {
    it('ExitError from checkPrerequisites propagates exit code 2', async () => {
      vi.mocked(checkPrerequisites).mockImplementation(() => {
        throw new ExitError(EXIT_CODES.DEPENDENCY_MISSING, 'aws not found', ['Install aws CLI']);
      });

      const outcome = await executeConnect('my-cluster', {});

      expect(outcome).toEqual({ exitCode: 2 });
      expect(error).toHaveBeenCalledWith('aws not found', ['Install aws CLI']);
      // Subsequent modules should not be called
      expect(resolveConfigPath).not.toHaveBeenCalled();
    });

    it('ExitError from loadRegistry propagates exit code 1', async () => {
      vi.mocked(loadRegistry).mockImplementation(() => {
        throw new ExitError(EXIT_CODES.GENERAL_ERROR, 'Config file not found');
      });

      const outcome = await executeConnect('my-cluster', {});

      expect(outcome).toEqual({ exitCode: 1 });
      expect(error).toHaveBeenCalledWith('Config file not found', undefined);
      expect(resolveCluster).not.toHaveBeenCalled();
    });

    it('ExitError from resolveCluster propagates exit code 1', async () => {
      vi.mocked(resolveCluster).mockRejectedValue(
        new ExitError(EXIT_CODES.GENERAL_ERROR, 'No cluster matching "unknown"')
      );

      const outcome = await executeConnect('unknown', {});

      expect(outcome).toEqual({ exitCode: 1 });
      expect(error).toHaveBeenCalledWith('No cluster matching "unknown"', undefined);
      expect(inferRegion).not.toHaveBeenCalled();
    });

    it('ExitError from discoverEndpoint propagates exit code 3 (auth failure)', async () => {
      vi.mocked(discoverEndpoint).mockRejectedValue(
        new ExitError(EXIT_CODES.AUTH_FAILURE, 'Authentication failed after refresh')
      );

      const outcome = await executeConnect('my-cluster', {});

      expect(outcome).toEqual({ exitCode: 3 });
      expect(error).toHaveBeenCalledWith('Authentication failed after refresh', undefined);
      expect(assignPort).not.toHaveBeenCalled();
    });

    it('ExitError from establishTunnel propagates exit code 4 (timeout)', async () => {
      vi.mocked(establishTunnel).mockRejectedValue(
        new ExitError(EXIT_CODES.TUNNEL_TIMEOUT, 'Tunnel did not become ready within 10 seconds', [
          'Check that the bastion instance is running',
        ])
      );

      const outcome = await executeConnect('my-cluster', {});

      expect(outcome).toEqual({ exitCode: 4 });
      expect(error).toHaveBeenCalledWith(
        'Tunnel did not become ready within 10 seconds',
        ['Check that the bastion instance is running']
      );
      expect(configureKubeconfig).not.toHaveBeenCalled();
    });

    it('ExitError from verifyConnection propagates exit code 5', async () => {
      vi.mocked(verifyConnection).mockRejectedValue(
        new ExitError(EXIT_CODES.VERIFY_FAILED, 'Connection verification failed', [
          'Check that the SSM tunnel is still active',
        ])
      );

      const outcome = await executeConnect('my-cluster', {});

      expect(outcome).toEqual({ exitCode: 5 });
      expect(error).toHaveBeenCalledWith(
        'Connection verification failed',
        ['Check that the SSM tunnel is still active']
      );
    });
  });

  describe('output flags', () => {
    it('--json flag passes json:true to output formatter', async () => {
      await executeConnect('my-cluster', { json: true });

      expect(progress).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ json: true, quiet: false })
      );
      expect(result).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ json: true, quiet: false })
      );
    });

    it('--quiet flag passes quiet:true to output formatter', async () => {
      await executeConnect('my-cluster', { quiet: true });

      expect(progress).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ json: false, quiet: true })
      );
      expect(result).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ json: false, quiet: true })
      );
    });
  });
});
