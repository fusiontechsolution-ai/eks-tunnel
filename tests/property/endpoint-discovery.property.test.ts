import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

/**
 * Property tests for endpoint discovery and SSM parameter construction.
 * Validates: Requirements 7.2, 9.2
 */

// Mock child_process and auth module before importing endpoint-discoverer
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../src/modules/auth/index.js', () => ({
  createAuthProvider: vi.fn(() => ({
    refresh: vi.fn(),
    getInstructions: vi.fn(() => ''),
  })),
}));

import { execSync } from 'child_process';
import { discoverEndpoint } from '../../src/modules/endpoint-discoverer.js';
import { buildSsmParameters } from '../../src/modules/ssm-params.js';

const mockedExecSync = vi.mocked(execSync);

// ---------- Custom Arbitraries ----------

const arbEndpointUrl = fc.tuple(
  fc.hexaString({ minLength: 10, maxLength: 20 }),
  fc.constantFrom('us-east-1', 'eu-west-1', 'ap-southeast-1')
).map(([id, region]) => `https://${id}.gr7.${region}.eks.amazonaws.com`);

const arbCaData = fc.base64String({ minLength: 20, maxLength: 100 });

const arbDescribeClusterResponse = fc.tuple(arbEndpointUrl, arbCaData).map(
  ([endpoint, caData]) => JSON.stringify({
    cluster: {
      endpoint,
      certificateAuthority: { data: caData }
    }
  })
);

const arbBastionId = fc.hexaString({ minLength: 17, maxLength: 17 }).map(hex => `i-${hex}`);
const arbLocalPort = fc.integer({ min: 1024, max: 65535 });
const arbProfile = fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0);
const arbRegion = fc.constantFrom('us-east-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'ap-southeast-1');

// ---------- Property 8: Endpoint Extraction from Describe-Cluster Response ----------

describe('Property 8: Endpoint Extraction from Describe-Cluster Response', () => {
  /**
   * Validates: Requirements 7.2
   * For any valid describe-cluster JSON response containing a .cluster.endpoint URL
   * and .cluster.certificateAuthority.data string, the endpoint discoverer SHALL extract
   * both values correctly, with the host field being the endpoint URL stripped of the
   * https:// prefix.
   */

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('correctly extracts url, host, and caData from any valid describe-cluster response', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDescribeClusterResponse,
        async (responseJson) => {
          // Parse to get the expected values
          const parsed = JSON.parse(responseJson);
          const expectedUrl = parsed.cluster.endpoint;
          const expectedHost = expectedUrl.replace('https://', '');
          const expectedCaData = parsed.cluster.certificateAuthority.data;

          // Mock execSync to return the generated response
          mockedExecSync.mockReturnValue(responseJson as any);

          const result = await discoverEndpoint('test-cluster', 'test-profile', 'us-east-1');

          expect(result.url).toBe(expectedUrl);
          expect(result.host).toBe(expectedHost);
          expect(result.caData).toBe(expectedCaData);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('host field never contains the https:// prefix', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDescribeClusterResponse,
        async (responseJson) => {
          mockedExecSync.mockReturnValue(responseJson as any);

          const result = await discoverEndpoint('test-cluster', 'test-profile', 'us-east-1');

          expect(result.host).not.toContain('https://');
          expect(result.url).toContain('https://');
          expect(result.url).toBe(`https://${result.host}`);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------- Property 10: SSM Parameter Construction ----------

describe('Property 10: SSM Parameter Construction', () => {
  /**
   * Validates: Requirements 9.2
   * For any EKS endpoint URL, bastion ID, local port, profile, and region,
   * the SSM parameters SHALL contain: host extracted without https:// prefix,
   * portNumber of 443, localPortNumber matching the assigned local port,
   * and target matching the bastion instance ID.
   */

  it('constructs SSM parameters with correct host, portNumber 443, localPortNumber, and target', () => {
    fc.assert(
      fc.property(
        arbEndpointUrl,
        arbBastionId,
        arbLocalPort,
        arbProfile,
        arbRegion,
        (endpointUrl, bastionId, localPort, profile, region) => {
          const result = buildSsmParameters(endpointUrl, bastionId, localPort, profile, region);

          // Host should be endpoint URL without https://
          const expectedHost = endpointUrl.replace('https://', '');
          expect(result.parameters.host).toEqual([expectedHost]);

          // portNumber must always be 443 (EKS API server port)
          expect(result.parameters.portNumber).toEqual(['443']);

          // localPortNumber must match the assigned local port
          expect(result.parameters.localPortNumber).toEqual([String(localPort)]);

          // target must be the bastion instance ID
          expect(result.target).toBe(bastionId);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('host in SSM parameters never contains https:// prefix', () => {
    fc.assert(
      fc.property(
        arbEndpointUrl,
        arbBastionId,
        arbLocalPort,
        arbProfile,
        arbRegion,
        (endpointUrl, bastionId, localPort, profile, region) => {
          const result = buildSsmParameters(endpointUrl, bastionId, localPort, profile, region);

          expect(result.parameters.host[0]).not.toContain('https://');
          expect(result.parameters.host[0]).not.toContain('http://');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('document name is always AWS-StartPortForwardingSessionToRemoteHost', () => {
    fc.assert(
      fc.property(
        arbEndpointUrl,
        arbBastionId,
        arbLocalPort,
        arbProfile,
        arbRegion,
        (endpointUrl, bastionId, localPort, profile, region) => {
          const result = buildSsmParameters(endpointUrl, bastionId, localPort, profile, region);

          expect(result.documentName).toBe('AWS-StartPortForwardingSessionToRemoteHost');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves profile and region in the SSM parameters', () => {
    fc.assert(
      fc.property(
        arbEndpointUrl,
        arbBastionId,
        arbLocalPort,
        arbProfile,
        arbRegion,
        (endpointUrl, bastionId, localPort, profile, region) => {
          const result = buildSsmParameters(endpointUrl, bastionId, localPort, profile, region);

          expect(result.profile).toBe(profile);
          expect(result.region).toBe(region);
        }
      ),
      { numRuns: 100 }
    );
  });
});
