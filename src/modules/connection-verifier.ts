import { execSync } from 'child_process';
import { ExitError } from '../errors.js';
import { EXIT_CODES } from '../constants.js';
import type { VerificationResult } from '../types.js';

/**
 * Verifies connectivity to a Kubernetes cluster by running
 * `kubectl get nodes` through the configured context.
 *
 * @param contextName - The kubeconfig context to verify against
 * @returns A VerificationResult with the node count on success
 * @throws ExitError with exit code 5 if verification fails
 */
export async function verifyConnection(contextName: string): Promise<VerificationResult> {
  try {
    const output = execSync(
      `kubectl get nodes --context ${contextName} --request-timeout=10s`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const lines = output.split('\n').filter((line) => line.trim() !== '');
    // First line is the header (NAME, STATUS, ROLES, AGE, VERSION)
    const nodeCount = lines.length > 1 ? lines.length - 1 : 0;

    return { success: true, nodeCount };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Connection verification failed';

    throw new ExitError(EXIT_CODES.VERIFY_FAILED, message, [
      'Check that the SSM tunnel is still active',
      'Verify your AWS credentials are valid',
      "Try running 'eks-tunnel status' to check tunnel health",
    ]);
  }
}
