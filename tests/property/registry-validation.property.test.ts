import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resolveConfigPath, loadRegistry } from '../../src/modules/registry-loader';
import { ExitError } from '../../src/errors';
import { DEFAULT_CONFIG_PATH } from '../../src/constants';

/**
 * Property tests for registry validation.
 * Validates: Requirements 3.1, 3.2, 3.3, 3.5, 3.6
 */

// Custom arbitraries
const arbAccountId = fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 12, maxLength: 12 });

const arbClusterEntry = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  bastionInstanceId: fc.string({ minLength: 1, maxLength: 30 }),
  region: fc.option(fc.constantFrom('us-east-1', 'eu-west-1', 'ap-southeast-1')),
});

const arbAccountEntry = fc.record({
  accountId: arbAccountId,
  accountName: fc.string({ minLength: 1, maxLength: 30 }),
  profile: fc.string({ minLength: 1, maxLength: 50 }),
  authMethod: fc.option(fc.constantFrom('sso', 'iam', 'provider')),
  clusters: fc.array(arbClusterEntry, { minLength: 1, maxLength: 5 }),
});

const arbRegistry = fc.record({
  accounts: fc.array(arbAccountEntry, { minLength: 1, maxLength: 5 }),
});

// Arbitrary for file paths (non-empty strings without ~)
const arbFilePath = fc.string({ minLength: 1, maxLength: 100 }).filter(s => !s.includes('\0') && s.trim().length > 0);

describe('Property 1: Config Resolution Precedence', () => {
  /**
   * Validates: Requirements 3.1, 3.2, 3.3
   * For any combination of flag value, env var value, and default path:
   * - If flag is provided, that path is used
   * - If no flag but env var set, env var is used
   * - If neither, default path is used
   */

  const originalEnv = process.env.EKS_TUNNEL_CONFIG;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.EKS_TUNNEL_CONFIG = originalEnv;
    } else {
      delete process.env.EKS_TUNNEL_CONFIG;
    }
  });

  it('--config flag takes highest precedence over env var and default', () => {
    fc.assert(
      fc.property(
        arbFilePath,
        arbFilePath,
        (flagValue, envValue) => {
          process.env.EKS_TUNNEL_CONFIG = envValue;
          const result = resolveConfigPath(flagValue);
          // The flag value should be used (possibly with ~ expanded)
          const expected = flagValue.startsWith('~')
            ? path.join(os.homedir(), flagValue.slice(1))
            : flagValue;
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('env var takes precedence when no flag is provided', () => {
    fc.assert(
      fc.property(
        arbFilePath,
        (envValue) => {
          process.env.EKS_TUNNEL_CONFIG = envValue;
          const result = resolveConfigPath(undefined);
          const expected = envValue.startsWith('~')
            ? path.join(os.homedir(), envValue.slice(1))
            : envValue;
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('default path is used when neither flag nor env var is set', () => {
    delete process.env.EKS_TUNNEL_CONFIG;
    const result = resolveConfigPath(undefined);
    const expected = path.join(os.homedir(), '.eks-tunnel/clusters.json');
    expect(result).toBe(expected);
  });
});

describe('Property 2: Invalid JSON Rejection', () => {
  /**
   * Validates: Requirements 3.5
   * For any string that is NOT valid JSON, loadRegistry should throw ExitError with exit code 1
   */

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-tunnel-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects any non-JSON string with exit code 1 and parse error context', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter(s => {
          try {
            JSON.parse(s);
            return false;
          } catch {
            return true;
          }
        }),
        (invalidJson) => {
          const filePath = path.join(tmpDir, 'invalid.json');
          fs.writeFileSync(filePath, invalidJson, 'utf-8');

          try {
            loadRegistry(filePath);
            // Should not reach here
            expect.fail('Expected ExitError to be thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(ExitError);
            const exitErr = err as ExitError;
            expect(exitErr.exitCode).toBe(1);
            expect(exitErr.message).toContain('Invalid JSON');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Property 3: Schema Validation Round-Trip', () => {
  /**
   * Validates: Requirements 3.6
   * For any valid ClusterRegistry object, verify successful parse;
   * for any object missing required fields, verify rejection
   */

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eks-tunnel-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('successfully parses any valid ClusterRegistry object', () => {
    fc.assert(
      fc.property(
        arbRegistry,
        (registry) => {
          // Convert fc.option (null | T) to the expected format (undefined | T)
          const cleaned = {
            accounts: registry.accounts.map(acc => ({
              accountId: acc.accountId,
              accountName: acc.accountName,
              profile: acc.profile,
              ...(acc.authMethod !== null ? { authMethod: acc.authMethod } : {}),
              clusters: acc.clusters.map(cl => ({
                name: cl.name,
                bastionInstanceId: cl.bastionInstanceId,
                ...(cl.region !== null ? { region: cl.region } : {}),
              })),
            })),
          };

          const filePath = path.join(tmpDir, `valid-${Date.now()}-${Math.random()}.json`);
          fs.writeFileSync(filePath, JSON.stringify(cleaned), 'utf-8');

          const result = loadRegistry(filePath);
          expect(result.accounts).toHaveLength(cleaned.accounts.length);
          for (let i = 0; i < result.accounts.length; i++) {
            expect(result.accounts[i].accountId).toBe(cleaned.accounts[i].accountId);
            expect(result.accounts[i].accountName).toBe(cleaned.accounts[i].accountName);
            expect(result.accounts[i].profile).toBe(cleaned.accounts[i].profile);
            expect(result.accounts[i].clusters).toHaveLength(cleaned.accounts[i].clusters.length);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects objects missing the accounts field', () => {
    fc.assert(
      fc.property(
        fc.record({
          notAccounts: fc.array(fc.string()),
        }),
        (invalidObj) => {
          const filePath = path.join(tmpDir, `no-accounts-${Date.now()}-${Math.random()}.json`);
          fs.writeFileSync(filePath, JSON.stringify(invalidObj), 'utf-8');

          try {
            loadRegistry(filePath);
            expect.fail('Expected ExitError to be thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(ExitError);
            const exitErr = err as ExitError;
            expect(exitErr.exitCode).toBe(1);
            expect(exitErr.message).toContain('Invalid config schema');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects account entries missing required fields', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('accountId', 'accountName', 'profile', 'clusters'),
        arbAccountId,
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (missingField, accountId, accountName, profile) => {
          const fullAccount: Record<string, unknown> = {
            accountId,
            accountName,
            profile,
            clusters: [{ name: 'test-cluster', bastionInstanceId: 'i-abc123' }],
          };

          // Remove the required field
          delete fullAccount[missingField];

          const registry = { accounts: [fullAccount] };
          const filePath = path.join(tmpDir, `missing-field-${Date.now()}-${Math.random()}.json`);
          fs.writeFileSync(filePath, JSON.stringify(registry), 'utf-8');

          try {
            loadRegistry(filePath);
            expect.fail('Expected ExitError to be thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(ExitError);
            const exitErr = err as ExitError;
            expect(exitErr.exitCode).toBe(1);
            expect(exitErr.message).toContain('Invalid config schema');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects cluster entries missing required fields', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('name', 'bastionInstanceId'),
        arbAccountId,
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (missingField, accountId, accountName, profile) => {
          const fullCluster: Record<string, unknown> = {
            name: 'test-cluster',
            bastionInstanceId: 'i-abc123',
          };

          // Remove the required field
          delete fullCluster[missingField];

          const registry = {
            accounts: [{
              accountId,
              accountName,
              profile,
              clusters: [fullCluster],
            }],
          };
          const filePath = path.join(tmpDir, `missing-cluster-field-${Date.now()}-${Math.random()}.json`);
          fs.writeFileSync(filePath, JSON.stringify(registry), 'utf-8');

          try {
            loadRegistry(filePath);
            expect.fail('Expected ExitError to be thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(ExitError);
            const exitErr = err as ExitError;
            expect(exitErr.exitCode).toBe(1);
            expect(exitErr.message).toContain('Invalid config schema');
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
