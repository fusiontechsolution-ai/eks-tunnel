import { ClusterEntry } from '../types';
import { ExitError } from '../errors';
import { EXIT_CODES } from '../constants';
import inquirer from 'inquirer';

/** Regex pattern for valid AWS region format. */
const REGION_REGEX = /^[a-z]{2}-[a-z]+-[0-9]+$/;

/** Regex to extract region from cluster name prefix (e.g., "us-east-1-my-cluster"). */
const REGION_PREFIX_REGEX = /^([a-z]{2}-[a-z]+-[0-9]+)-/;

/**
 * Validates whether a string matches the AWS region format.
 *
 * @param region - The string to validate
 * @returns true if the string matches the region pattern
 */
export function isValidRegion(region: string): boolean {
  return REGION_REGEX.test(region);
}

/**
 * Infers the AWS region for a cluster entry.
 *
 * Resolution order:
 * 1. If `cluster.region` is set and valid, return it
 * 2. If `cluster.region` is set but invalid, throw ExitError(1)
 * 3. Try to extract region from the cluster name prefix
 * 4. If cannot infer:
 *    - Interactive: prompt the user for region input
 *    - Non-interactive: throw ExitError(1) with guidance
 *
 * @param cluster - The cluster entry to infer region for
 * @param interactive - Whether interactive prompts are allowed
 * @returns The resolved AWS region string
 * @throws ExitError(1) if region cannot be determined
 */
export async function inferRegion(
  cluster: ClusterEntry,
  interactive: boolean
): Promise<string> {
  // 1. Check explicit region field
  if (cluster.region) {
    if (isValidRegion(cluster.region)) {
      return cluster.region;
    }
    // Explicit region is set but invalid format
    throw new ExitError(
      EXIT_CODES.GENERAL_ERROR,
      `Invalid region format '${cluster.region}' for cluster '${cluster.name}'. Region must match format: xx-xxxx-N (e.g., us-east-1, eu-west-2).`
    );
  }

  // 2. Try to extract region from cluster name prefix
  const match = cluster.name.match(REGION_PREFIX_REGEX);
  if (match) {
    const extracted = match[1];
    if (isValidRegion(extracted)) {
      return extracted;
    }
  }

  // 3. Cannot infer region
  if (interactive) {
    const { region } = await inquirer.prompt<{ region: string }>([
      {
        type: 'input',
        name: 'region',
        message: `Cannot infer region for cluster '${cluster.name}'. Enter AWS region:`,
        validate: (input: string) => {
          if (isValidRegion(input)) {
            return true;
          }
          return 'Invalid region format. Expected format: xx-xxxx-N (e.g., us-east-1, eu-west-2)';
        },
      },
    ]);
    return region;
  }

  // Non-interactive: throw error
  throw new ExitError(
    EXIT_CODES.GENERAL_ERROR,
    `Cannot infer region for cluster '${cluster.name}'. Add a 'region' field to the cluster entry in your config.`
  );
}
