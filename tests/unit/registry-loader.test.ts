import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveConfigPath, loadRegistry } from '../../src/modules/registry-loader';
import { ExitError } from '../../src/errors';

describe('resolveConfigPath', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.EKS_TUNNEL_CONFIG;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns --config flag value when provided', () => {
    const result = resolveConfigPath('/custom/path/config.json');
    expect(result).toBe('/custom/path/config.json');
  });

  it('returns EKS_TUNNEL_CONFIG env var when no flag provided', () => {
    process.env.EKS_TUNNEL_CONFIG = '/env/path/config.json';
    const result = resolveConfigPath();
    expect(result).toBe('/env/path/config.json');
  });

  it('returns default path when no flag or env var provided', () => {
    const result = resolveConfigPath();
    expect(result).toBe(path.join(os.homedir(), '.eks-tunnel/clusters.json'));
  });

  it('--config flag takes precedence over env var', () => {
    process.env.EKS_TUNNEL_CONFIG = '/env/path/config.json';
    const result = resolveConfigPath('/flag/path/config.json');
    expect(result).toBe('/flag/path/config.json');
  });

  it('resolves ~ to home directory', () => {
    const result = resolveConfigPath('~/my-config.json');
    expect(result).toBe(path.join(os.homedir(), 'my-config.json'));
  });

  it('resolves ~ in env var to home directory', () => {
    process.env.EKS_TUNNEL_CONFIG = '~/env-config.json';
    const result = resolveConfigPath();
    expect(result).toBe(path.join(os.homedir(), 'env-config.json'));
  });
});

describe('loadRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws ExitError(1) when file does not exist', () => {
    const missingPath = path.join(tmpDir, 'nonexistent.json');
    expect(() => loadRegistry(missingPath)).toThrow(ExitError);
    try {
      loadRegistry(missingPath);
    } catch (err) {
      const exitErr = err as ExitError;
      expect(exitErr.exitCode).toBe(1);
      expect(exitErr.message).toContain('Config file not found');
      expect(exitErr.message).toContain(missingPath);
      expect(exitErr.message).toContain('eks-tunnel init');
    }
  });

  it('throws ExitError(1) on invalid JSON', () => {
    const filePath = path.join(tmpDir, 'bad.json');
    fs.writeFileSync(filePath, 'not valid json {{{');
    expect(() => loadRegistry(filePath)).toThrow(ExitError);
    try {
      loadRegistry(filePath);
    } catch (err) {
      const exitErr = err as ExitError;
      expect(exitErr.exitCode).toBe(1);
      expect(exitErr.message).toContain('Invalid JSON in config file');
    }
  });

  it('throws ExitError(1) when root is not an object', () => {
    const filePath = path.join(tmpDir, 'array.json');
    fs.writeFileSync(filePath, '[]');
    expect(() => loadRegistry(filePath)).toThrow(ExitError);
    try {
      loadRegistry(filePath);
    } catch (err) {
      const exitErr = err as ExitError;
      expect(exitErr.exitCode).toBe(1);
      expect(exitErr.message).toContain('root must be an object');
    }
  });

  it('throws ExitError(1) when accounts is missing', () => {
    const filePath = path.join(tmpDir, 'no-accounts.json');
    fs.writeFileSync(filePath, '{}');
    expect(() => loadRegistry(filePath)).toThrow(ExitError);
    try {
      loadRegistry(filePath);
    } catch (err) {
      const exitErr = err as ExitError;
      expect(exitErr.exitCode).toBe(1);
      expect(exitErr.message).toContain('accounts');
    }
  });

  it('throws ExitError(1) when account is missing required fields', () => {
    const filePath = path.join(tmpDir, 'bad-account.json');
    fs.writeFileSync(filePath, JSON.stringify({
      accounts: [{ accountId: '123' }]
    }));
    expect(() => loadRegistry(filePath)).toThrow(ExitError);
    try {
      loadRegistry(filePath);
    } catch (err) {
      const exitErr = err as ExitError;
      expect(exitErr.exitCode).toBe(1);
      expect(exitErr.message).toContain('accounts[0].accountName');
    }
  });

  it('throws ExitError(1) when cluster is missing required fields', () => {
    const filePath = path.join(tmpDir, 'bad-cluster.json');
    fs.writeFileSync(filePath, JSON.stringify({
      accounts: [{
        accountId: '123456789012',
        accountName: 'test',
        profile: 'default',
        clusters: [{ name: 'my-cluster' }]
      }]
    }));
    expect(() => loadRegistry(filePath)).toThrow(ExitError);
    try {
      loadRegistry(filePath);
    } catch (err) {
      const exitErr = err as ExitError;
      expect(exitErr.exitCode).toBe(1);
      expect(exitErr.message).toContain('bastionInstanceId');
    }
  });

  it('successfully loads a valid registry', () => {
    const validRegistry = {
      accounts: [{
        accountId: '123456789012',
        accountName: 'production',
        profile: 'prod-profile',
        clusters: [{
          name: 'eu-west-1-my-cluster',
          bastionInstanceId: 'i-0abc123def456'
        }]
      }]
    };
    const filePath = path.join(tmpDir, 'valid.json');
    fs.writeFileSync(filePath, JSON.stringify(validRegistry));

    const result = loadRegistry(filePath);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].accountId).toBe('123456789012');
    expect(result.accounts[0].clusters[0].name).toBe('eu-west-1-my-cluster');
  });

  it('successfully loads a registry with optional fields', () => {
    const validRegistry = {
      accounts: [{
        accountId: '123456789012',
        accountName: 'production',
        profile: 'prod-profile',
        authMethod: 'provider',
        providerConfig: {
          command: 'my-tool',
          args: ['--flag', 'value']
        },
        clusters: [{
          name: 'eu-west-1-my-cluster',
          bastionInstanceId: 'i-0abc123def456',
          region: 'eu-west-1'
        }]
      }]
    };
    const filePath = path.join(tmpDir, 'full.json');
    fs.writeFileSync(filePath, JSON.stringify(validRegistry));

    const result = loadRegistry(filePath);
    expect(result.accounts[0].authMethod).toBe('provider');
    expect(result.accounts[0].providerConfig?.command).toBe('my-tool');
    expect(result.accounts[0].clusters[0].region).toBe('eu-west-1');
  });

  it('throws ExitError(1) on invalid authMethod', () => {
    const filePath = path.join(tmpDir, 'bad-auth.json');
    fs.writeFileSync(filePath, JSON.stringify({
      accounts: [{
        accountId: '123456789012',
        accountName: 'test',
        profile: 'default',
        authMethod: 'invalid',
        clusters: [{ name: 'cluster', bastionInstanceId: 'i-123' }]
      }]
    }));
    expect(() => loadRegistry(filePath)).toThrow(ExitError);
    try {
      loadRegistry(filePath);
    } catch (err) {
      const exitErr = err as ExitError;
      expect(exitErr.exitCode).toBe(1);
      expect(exitErr.message).toContain('authMethod');
    }
  });

  it('resolves tilde in config path', () => {
    // This test verifies ~ resolution within loadRegistry itself
    // We can't easily test this without writing to home dir, so test the error path
    expect(() => loadRegistry('~/nonexistent-test-file-xyz.json')).toThrow(ExitError);
    try {
      loadRegistry('~/nonexistent-test-file-xyz.json');
    } catch (err) {
      const exitErr = err as ExitError;
      expect(exitErr.message).toContain(os.homedir());
    }
  });
});
