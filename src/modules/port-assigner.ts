import { TunnelState } from '../types.js';
import { ExitError } from '../errors.js';
import { EXIT_CODES, DEFAULT_START_PORT } from '../constants.js';
import { detectPlatform, isPortInUse } from './platform-detector.js';

/**
 * Assigns a free local port for tunnel usage, avoiding conflicts with
 * active tunnels (from state file) and system ports currently in use.
 *
 * @param requestedPort - Optional specific port requested by the user
 * @param stateFile - Current tunnel state containing active tunnel entries
 * @returns The assigned port number
 * @throws ExitError with exit code 1 if no available port is found
 */
export async function assignPort(
  requestedPort: number | undefined,
  stateFile: TunnelState
): Promise<number> {
  const startPort = requestedPort ?? DEFAULT_START_PORT;
  const platform = detectPlatform();

  // Build set of ports occupied by existing tunnels in the state file
  const occupiedPorts = new Set(stateFile.tunnels.map(t => t.localPort));

  // Search for the lowest available port starting from startPort
  for (let port = startPort; port <= 65535; port++) {
    // Skip ports already claimed by active tunnels
    if (occupiedPorts.has(port)) {
      continue;
    }

    // Check if port is in use by the system
    const inUse = await isPortInUse(port, platform);
    if (inUse) {
      continue;
    }

    // Found an available port
    if (port !== startPort) {
      // We had to pick a different port than what was initially requested/defaulted
      console.log(`Port ${startPort} is in use, using port ${port} instead`);
    }

    return port;
  }

  // No port found in the entire range
  throw new ExitError(
    EXIT_CODES.GENERAL_ERROR,
    'No available port found',
    ['All ports from ' + startPort + ' to 65535 are in use. Try stopping some existing tunnels with `eks-tunnel stop-all`.']
  );
}
