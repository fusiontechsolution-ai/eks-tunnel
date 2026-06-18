import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { TunnelState } from '../../src/types.js';

/**
 * Property 9: Port Assignment Finds Lowest Available
 *
 * For any set of ports currently in use (by the system or recorded in the state file)
 * and an optional requested port, the port assigner SHALL return the lowest port number
 * >= the start port (8443 default, or requested port) that is not in the occupied set.
 * If a requested port is unavailable, the next available port SHALL be chosen.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3**
 */

// Mock platform-detector before importing the module under test
vi.mock('../../src/modules/platform-detector.js', () => ({
  detectPlatform: vi.fn().mockReturnValue('macos'),
  isPortInUse: vi.fn(),
}));

import { assignPort } from '../../src/modules/port-assigner.js';
import { isPortInUse } from '../../src/modules/platform-detector.js';

const mockedIsPortInUse = vi.mocked(isPortInUse);

describe('Property 9: Port Assignment Finds Lowest Available', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns lowest available port not in system or state file occupied sets', () => {
    fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 8443, max: 9000 }), { maxLength: 20 }),
        fc.option(fc.integer({ min: 8443, max: 9000 })),
        async (occupiedPorts, requestedPort) => {
          // Split occupiedPorts into "system" ports and "state file" ports
          const midpoint = Math.floor(occupiedPorts.length / 2);
          const systemPorts = new Set(occupiedPorts.slice(0, midpoint));
          const stateFilePorts = occupiedPorts.slice(midpoint);

          // Build state file with tunnel entries using the state file ports
          const stateFile: TunnelState = {
            tunnels: stateFilePorts.map((port) => ({
              clusterName: `cluster-${port}`,
              accountName: 'test-account',
              accountId: '123456789012',
              profile: 'test-profile',
              region: 'us-east-1',
              localPort: port,
              pid: 1000 + port,
              endpoint: 'https://test.eks.amazonaws.com',
              bastionId: 'i-0abc123def456',
              contextName: `eks-tunnel-cluster-${port}`,
              startedAt: new Date().toISOString(),
            })),
          };

          // Mock isPortInUse to return true for system-occupied ports
          mockedIsPortInUse.mockImplementation(async (port: number) => {
            return systemPorts.has(port);
          });

          // Call assignPort
          const result = await assignPort(requestedPort ?? undefined, stateFile);

          const startPort = requestedPort ?? 8443;
          const allOccupied = new Set(occupiedPorts);

          // Property 1: Result must be >= startPort
          expect(result).toBeGreaterThanOrEqual(startPort);

          // Property 2: Result must NOT be in any occupied set
          expect(allOccupied.has(result)).toBe(false);

          // Property 3: Result is the LOWEST available — every port from startPort
          // to result-1 must be in one of the occupied sets
          for (let p = startPort; p < result; p++) {
            expect(allOccupied.has(p)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
