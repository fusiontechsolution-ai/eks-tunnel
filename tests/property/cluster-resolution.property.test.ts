import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { resolveCluster } from '../../src/modules/cluster-resolver';
import { ExitError } from '../../src/errors';
import { ClusterEntry, AccountEntry, ClusterRegistry } from '../../src/types';

/**
 * Property tests for cluster resolution.
 * Validates: Requirements 5.1, 5.2, 5.3, 5.5, 5.7
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

function buildRegistry(clusters: ClusterEntry[]): ClusterRegistry {
  const account: AccountEntry = {
    accountId: '123456789012',
    accountName: 'test-account',
    profile: 'test-profile',
    clusters,
  };
  return { accounts: [account] };
}

function buildClusterEntry(name: string): ClusterEntry {
  return {
    name,
    bastionInstanceId: 'i-0abc123def456789a',
  };
}

describe('Property 4: Cluster Resolution Correctness', () => {
  /**
   * Validates: Requirements 5.1, 5.2, 5.3
   */

  it('exact match is always selected when query matches a cluster name exactly', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbClusterName, { minLength: 2, maxLength: 10 }).chain(names => {
          const uniqueNames = [...new Set(names)];
          if (uniqueNames.length < 2) return fc.constant(null);
          return fc.tuple(
            fc.constant(uniqueNames),
            fc.integer({ min: 0, max: uniqueNames.length - 1 })
          );
        }).filter((v): v is [string[], number] => v !== null),
        async ([clusterNames, targetIdx]) => {
          const clusters = clusterNames.map(buildClusterEntry);
          const registry = buildRegistry(clusters);
          const query = clusterNames[targetIdx];

          const result = await resolveCluster(query, registry, false);
          expect(result.cluster.name).toBe(query);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('single substring match is auto-selected', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(arbRegion, arbClusterSuffix, arbClusterSuffix).filter(
          ([, s1, s2]) => s1 !== s2 && !s1.includes(s2) && !s2.includes(s1)
        ),
        async ([region, suffix1, suffix2]) => {
          const name1 = `${region}-${suffix1}`;
          const name2 = `${region}-${suffix2}`;
          const clusters = [buildClusterEntry(name1), buildClusterEntry(name2)];
          const registry = buildRegistry(clusters);

          // Query using suffix1 which should only match name1
          const result = await resolveCluster(suffix1, registry, false);
          expect(result.cluster.name).toBe(name1);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('exact match takes priority over substring matches', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbClusterSuffix.filter(s => s.length >= 4),
        async (suffix) => {
          // Create clusters where one name is an exact match and another contains it as substring
          const exactName = suffix;
          const longerName = `us-east-1-${suffix}`;

          const clusters = [
            buildClusterEntry(exactName),
            buildClusterEntry(longerName),
          ];
          const registry = buildRegistry(clusters);

          const result = await resolveCluster(exactName, registry, false);
          expect(result.cluster.name).toBe(exactName);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 5: Non-Interactive Resolution Errors', () => {
  /**
   * Validates: Requirements 5.5, 5.7
   */

  it('zero matches in non-interactive mode throws ExitError(1) listing available names', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbClusterName, { minLength: 1, maxLength: 5 }).map(names => [...new Set(names)]),
        fc.stringMatching(/^[x][x][x][a-z]{5,10}$/),
        async (clusterNames, query) => {
          // Ensure query doesn't match any cluster name as substring
          const noMatch = clusterNames.every(name => !name.includes(query));
          if (!noMatch) return; // skip this case

          const clusters = clusterNames.map(buildClusterEntry);
          const registry = buildRegistry(clusters);

          try {
            await resolveCluster(query, registry, false);
            expect.fail('Expected ExitError to be thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(ExitError);
            const exitErr = err as ExitError;
            expect(exitErr.exitCode).toBe(1);
            // Error message should list available cluster names
            for (const name of clusterNames) {
              expect(exitErr.message).toContain(name);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('multiple matches in non-interactive mode throws ExitError(1) with ambiguous names', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.tuple(arbRegion, arbClusterSuffix, arbClusterSuffix).filter(
          ([, s1, s2]) => s1 !== s2
        ),
        async ([region, suffix1, suffix2]) => {
          // Both names share the region prefix, so querying the region substring gives multiple matches
          const name1 = `${region}-${suffix1}`;
          const name2 = `${region}-${suffix2}`;
          const clusters = [buildClusterEntry(name1), buildClusterEntry(name2)];
          const registry = buildRegistry(clusters);

          // Use the region as query - it's a substring of both names
          try {
            await resolveCluster(region, registry, false);
            expect.fail('Expected ExitError to be thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(ExitError);
            const exitErr = err as ExitError;
            expect(exitErr.exitCode).toBe(1);
            // Error message should contain the ambiguous cluster names
            expect(exitErr.message).toContain(name1);
            expect(exitErr.message).toContain(name2);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
