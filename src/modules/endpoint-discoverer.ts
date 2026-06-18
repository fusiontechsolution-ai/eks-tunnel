import { execSync } from 'child_process';
import { EksEndpoint, AccountEntry } from '../types.js';
import { ExitError } from '../errors.js';
import { EXIT_CODES } from '../constants.js';
import { createAuthProvider } from './auth/index.js';

/**
 * Auth error patterns returned by the AWS CLI when credentials are expired or invalid.
 */
const AUTH_ERROR_PATTERNS = [
  'ExpiredToken',
  'InvalidClientTokenId',
  'ExpiredTokenException',
];

/**
 * Checks whether an error message indicates an authentication failure.
 */
function isAuthError(message: string): boolean {
  return AUTH_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

/**
 * Executes the AWS CLI describe-cluster command and returns the raw stdout.
 */
function executeDescribeCluster(
  clusterName: string,
  profile: string,
  region: string
): string {
  const command = `aws eks describe-cluster --name ${clusterName} --profile ${profile} --region ${region} --output json`;
  return execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Parses the describe-cluster JSON response into an EksEndpoint.
 */
function parseEndpointResponse(output: string): EksEndpoint {
  const response = JSON.parse(output);
  const url: string = response.cluster.endpoint;
  const host = url.replace('https://', '');
  const caData: string = response.cluster.certificateAuthority.data;
  return { url, host, caData };
}

/**
 * Discovers the EKS API server endpoint for the given cluster by calling
 * `aws eks describe-cluster`. Handles auth errors by triggering a credential
 * refresh and retrying once.
 */
export async function discoverEndpoint(
  clusterName: string,
  profile: string,
  region: string,
  account?: AccountEntry
): Promise<EksEndpoint> {
  try {
    const output = executeDescribeCluster(clusterName, profile, region);
    return parseEndpointResponse(output);
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error);

    if (isAuthError(errorMessage) && account) {
      // Attempt auth refresh and retry
      const authMethod = account.authMethod || 'sso';
      const provider = createAuthProvider(authMethod);
      await provider.refresh(account);

      try {
        const output = executeDescribeCluster(clusterName, profile, region);
        return parseEndpointResponse(output);
      } catch (retryError: unknown) {
        const retryMessage = getErrorMessage(retryError);
        if (isAuthError(retryMessage)) {
          throw new ExitError(
            EXIT_CODES.AUTH_FAILURE,
            'Authentication failed after refresh'
          );
        }
        throw new ExitError(EXIT_CODES.GENERAL_ERROR, retryMessage);
      }
    }

    if (isAuthError(errorMessage) && !account) {
      throw new ExitError(EXIT_CODES.AUTH_FAILURE, errorMessage);
    }

    throw new ExitError(EXIT_CODES.GENERAL_ERROR, errorMessage);
  }
}

/**
 * Extracts a useful error message from an unknown caught error.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error && 'stderr' in error) {
    const stderr = (error as Error & { stderr: string | Buffer }).stderr;
    return typeof stderr === 'string' ? stderr : stderr.toString();
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
