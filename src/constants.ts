/**
 * Process exit codes used throughout the CLI.
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  DEPENDENCY_MISSING: 2,
  AUTH_FAILURE: 3,
  TUNNEL_TIMEOUT: 4,
  VERIFY_FAILED: 5,
} as const;

/** Default path to the cluster registry configuration file. */
export const DEFAULT_CONFIG_PATH = '~/.eks-tunnel/clusters.json';

/** Default path to the tunnel state file. */
export const DEFAULT_STATE_PATH = '~/.eks-tunnel/state.json';

/** Default starting port for tunnel port assignment. */
export const DEFAULT_START_PORT = 8443;
