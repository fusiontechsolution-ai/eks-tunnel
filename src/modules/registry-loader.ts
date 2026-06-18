import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ClusterRegistry, AccountEntry, ClusterEntry } from '../types';
import { ExitError } from '../errors';
import { EXIT_CODES, DEFAULT_CONFIG_PATH } from '../constants';

/**
 * Resolves the configuration file path based on precedence:
 * 1. --config flag (explicit path)
 * 2. EKS_TUNNEL_CONFIG environment variable
 * 3. Default path (~/.eks-tunnel/clusters.json)
 */
export function resolveConfigPath(configFlag?: string): string {
  let configPath: string;

  if (configFlag) {
    configPath = configFlag;
  } else if (process.env.EKS_TUNNEL_CONFIG) {
    configPath = process.env.EKS_TUNNEL_CONFIG;
  } else {
    configPath = DEFAULT_CONFIG_PATH;
  }

  // Resolve ~ to user's home directory
  if (configPath.startsWith('~')) {
    configPath = path.join(os.homedir(), configPath.slice(1));
  }

  return configPath;
}

/**
 * Loads and validates the cluster registry from a JSON config file.
 *
 * @param configPath - Absolute or resolvable path to the config file
 * @returns A validated ClusterRegistry object
 * @throws ExitError(1) if file is missing, JSON is invalid, or schema validation fails
 */
export function loadRegistry(configPath: string): ClusterRegistry {
  // Resolve ~ in the provided path
  let resolvedPath = configPath;
  if (resolvedPath.startsWith('~')) {
    resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
  }

  // Check file exists
  if (!fs.existsSync(resolvedPath)) {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Config file not found at ${resolvedPath}. Run 'eks-tunnel init' to create one.`
    );
  }

  // Read file content
  const content = fs.readFileSync(resolvedPath, 'utf-8');

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const message = err instanceof SyntaxError ? err.message : String(err);
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Invalid JSON in config file: ${message}`
    );
  }

  // Validate schema
  validateSchema(parsed);

  return parsed as ClusterRegistry;
}

/**
 * Validates that the parsed JSON conforms to the ClusterRegistry schema.
 */
function validateSchema(data: unknown): void {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      'Invalid config schema: root must be an object'
    );
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.accounts)) {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      'Invalid config schema: missing or invalid "accounts" array'
    );
  }

  for (let i = 0; i < obj.accounts.length; i++) {
    validateAccount(obj.accounts[i], i);
  }
}

/**
 * Validates a single account entry in the registry.
 */
function validateAccount(account: unknown, index: number): void {
  if (typeof account !== 'object' || account === null || Array.isArray(account)) {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Invalid config schema: accounts[${index}] must be an object`
    );
  }

  const acc = account as Record<string, unknown>;
  const requiredFields: Array<{ field: string; type: string }> = [
    { field: 'accountId', type: 'string' },
    { field: 'accountName', type: 'string' },
    { field: 'profile', type: 'string' },
  ];

  for (const { field, type } of requiredFields) {
    if (typeof acc[field] !== type) {
      throw new ExitError(
        EXIT_CODES.GENERAL_ERROR,
        `Invalid config schema: accounts[${index}].${field} must be a ${type}`
      );
    }
  }

  if (!Array.isArray(acc.clusters)) {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Invalid config schema: accounts[${index}].clusters must be an array`
    );
  }

  // Validate optional authMethod
  if (acc.authMethod !== undefined) {
    if (!['sso', 'iam', 'provider'].includes(acc.authMethod as string)) {
      throw new ExitError(
        EXIT_CODES.GENERAL_ERROR,
        `Invalid config schema: accounts[${index}].authMethod must be 'sso', 'iam', or 'provider'`
      );
    }
  }

  // Validate optional providerConfig
  if (acc.providerConfig !== undefined) {
    validateProviderConfig(acc.providerConfig, index);
  }

  for (let j = 0; j < acc.clusters.length; j++) {
    validateCluster(acc.clusters[j], index, j);
  }
}

/**
 * Validates a providerConfig entry.
 */
function validateProviderConfig(config: unknown, accountIndex: number): void {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Invalid config schema: accounts[${accountIndex}].providerConfig must be an object`
    );
  }

  const cfg = config as Record<string, unknown>;

  if (typeof cfg.command !== 'string') {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Invalid config schema: accounts[${accountIndex}].providerConfig.command must be a string`
    );
  }

  if (!Array.isArray(cfg.args)) {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Invalid config schema: accounts[${accountIndex}].providerConfig.args must be an array`
    );
  }
}

/**
 * Validates a single cluster entry within an account.
 */
function validateCluster(cluster: unknown, accountIndex: number, clusterIndex: number): void {
  if (typeof cluster !== 'object' || cluster === null || Array.isArray(cluster)) {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Invalid config schema: accounts[${accountIndex}].clusters[${clusterIndex}] must be an object`
    );
  }

  const cl = cluster as Record<string, unknown>;

  if (typeof cl.name !== 'string') {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Invalid config schema: accounts[${accountIndex}].clusters[${clusterIndex}].name must be a string`
    );
  }

  if (typeof cl.bastionInstanceId !== 'string') {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Invalid config schema: accounts[${accountIndex}].clusters[${clusterIndex}].bastionInstanceId must be a string`
    );
  }

  // Validate optional region
  if (cl.region !== undefined && typeof cl.region !== 'string') {
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Invalid config schema: accounts[${accountIndex}].clusters[${clusterIndex}].region must be a string`
    );
  }
}
