import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { inferRegion, isValidRegion } from '../../src/modules/region-inferrer';
import { ExitError } from '../../src/errors';
import { ClusterEntry } from '../../src/types';

/**
 * Property tests for region inference.
 * Validates: Requirements 6.1, 6.2, 6.5
 */

// Custom arbitraries
const arbRegion = fc.constantFrom(
  'us-east-1', 'us-west-2', 'eu-west-1', 'eu-west-2',
  'eu-central-1', 'ap-northeast-1', 'ap-southeast-2'
);
const arbClusterSuffix = fc.stringMatching(/^[a-z][a-z0-9-]{2,20}$/);
const arbClusterName = fc.tuple(arbRegion, arbClusterSuffix).map(
  ([region, suffix]) => `${region}-${suffix}`
);

// Arbitrary for valid region format strings (beyond the fixed list)
const arbValidRegionFormat = fc.tuple(
  fc.stringMatching(/^[a-z]{2}$/),
  fc.stringMatching(/^[a-z]+$/),
  fc.integer({ min: 1, max: 99 })
).map(([country, direction, num]) => `${country}-${direction}-${num}`);

// Arbitrary for strings that do NOT match the region format
const arbInvalidRegion = fc.oneof(
  fc.constant(''),
  fc.constant('US-EAST-1'),       // uppercase
  fc.constant('us_east_1'),       // underscores
  fc.constant('useast1'),         // no hyphens
  fc.constant('us-east'),         // missing digit
  fc.constant('1-east-1'),        // starts with digit
  fc.stringMatching(/^[A-Z][a-z0-9-]{2,20}$/), // starts with uppercase
  fc.stringMatching(/^[a-z]{2}-[a-z]+-[a-z]+$/), // ends with letters not digits
  fc.stringMatching(/^[a-z]{3,5}-[a-z]+-[0-9]+$/) // country code too long (3+ chars)
);

function buildClusterEntry(name: string, region?: string): ClusterEntry {
  return {
    name,
    bastionInstanceId: 'i-0abc123def456789a',
    ...(region !== undefined ? { region } : {}),
  };
}

describe('Property 6: Region Inference Priority', () => {
  /**
   * Validates: Requirements 6.1, 6.2
   */

  it('explicit region field is always returned regardless of cluster name', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRegion,
        arbClusterName,
        async (explicitRegion, clusterName) => {
          const cluster = buildClusterEntry(clusterName, explicitRegion);
          const result = await inferRegion(cluster, false);
          expect(result).toBe(explicitRegion);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('cluster name prefix extraction works for valid region-prefixed names', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRegion,
        arbClusterSuffix,
        async (region, suffix) => {
          const clusterName = `${region}-${suffix}`;
          const cluster = buildClusterEntry(clusterName);
          const result = await inferRegion(cluster, false);
          expect(result).toBe(region);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('explicit region takes priority over name-inferred region', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbRegion,
        arbRegion,
        arbClusterSuffix,
        async (explicitRegion, nameRegion, suffix) => {
          const clusterName = `${nameRegion}-${suffix}`;
          const cluster = buildClusterEntry(clusterName, explicitRegion);
          const result = await inferRegion(cluster, false);
          // The explicit region should always win, even when the name contains a different region
          expect(result).toBe(explicitRegion);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('throws ExitError(1) in non-interactive mode when region cannot be inferred', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Cluster names that don't start with a valid region prefix
        fc.stringMatching(/^[a-z]{1}[a-z0-9]{2,15}$/).filter(
          name => !name.match(/^[a-z]{2}-[a-z]+-[0-9]+/)
        ),
        async (clusterName) => {
          const cluster = buildClusterEntry(clusterName);
          try {
            await inferRegion(cluster, false);
            expect.fail('Expected ExitError to be thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(ExitError);
            const exitErr = err as ExitError;
            expect(exitErr.exitCode).toBe(1);
            expect(exitErr.message).toContain('Cannot infer region');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 7: Region Format Validation', () => {
  /**
   * Validates: Requirements 6.5
   */

  it('accepts strings matching the region pattern ^[a-z]{2}-[a-z]+-[0-9]+$', () => {
    fc.assert(
      fc.property(
        arbValidRegionFormat,
        (region) => {
          expect(isValidRegion(region)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects strings NOT matching the region pattern', () => {
    fc.assert(
      fc.property(
        arbInvalidRegion,
        (invalidRegion) => {
          expect(isValidRegion(invalidRegion)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('known AWS regions are all valid', () => {
    fc.assert(
      fc.property(
        arbRegion,
        (region) => {
          expect(isValidRegion(region)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty string is rejected', () => {
    expect(isValidRegion('')).toBe(false);
  });

  it('region with uppercase letters is rejected', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[A-Z]{2}-[a-z]+-[0-9]+$/),
        (region) => {
          expect(isValidRegion(region)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
