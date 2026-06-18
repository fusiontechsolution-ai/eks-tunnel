/**
 * Global CLI options available across all commands.
 */
export interface GlobalOptions {
  config?: string;       // --config path override
  port?: number;         // --port explicit port
  json?: boolean;        // --json output mode
  quiet?: boolean;       // --quiet suppress progress
  watch?: boolean;       // --watch auto-reconnect mode
  skipPrereqs?: boolean; // --skip-prereqs bypass checks
}

/**
 * A single cluster entry within an account configuration.
 */
export interface ClusterEntry {
  name: string;
  bastionInstanceId: string;
  region?: string; // Optional explicit region override
}

/**
 * An AWS account with its associated clusters and auth configuration.
 */
export interface AccountEntry {
  accountId: string;
  accountName: string;
  profile: string;
  authMethod?: 'sso' | 'iam' | 'provider'; // Defaults to 'sso'
  providerConfig?: ProviderConfig;
  clusters: ClusterEntry[];
}

/**
 * External credential provider configuration.
 */
export interface ProviderConfig {
  command: string;
  args: string[];
}

/**
 * Top-level cluster registry structure loaded from the config file.
 */
export interface ClusterRegistry {
  accounts: AccountEntry[];
}

/**
 * A cluster resolved to its specific entry and parent account context.
 */
export interface ResolvedCluster {
  cluster: ClusterEntry;
  account: AccountEntry;
}

/**
 * Discovered EKS API server endpoint information.
 */
export interface EksEndpoint {
  url: string;    // Full HTTPS URL
  host: string;   // Host portion (no scheme)
  caData: string; // Base64-encoded CA cert
}

/**
 * A single tunnel entry persisted in the state file.
 */
export interface TunnelEntry {
  clusterName: string;
  accountName: string;
  accountId: string;
  profile: string;
  region: string;
  localPort: number;
  pid: number;
  endpoint: string;
  bastionId: string;
  contextName: string;
  startedAt: string;
}

/**
 * The full tunnel state persisted to disk.
 */
export interface TunnelState {
  tunnels: TunnelEntry[];
}

/**
 * Result of establishing a tunnel.
 */
export interface TunnelResult {
  pid: number;
  localPort: number;
}

/**
 * Result of configuring kubeconfig.
 */
export interface KubeconfigResult {
  contextName: string;
}

/**
 * Result of verifying cluster connectivity.
 */
export interface VerificationResult {
  success: boolean;
  nodeCount: number;
}

/**
 * Output formatting options derived from global flags.
 */
export interface OutputOptions {
  json: boolean;
  quiet: boolean;
}
