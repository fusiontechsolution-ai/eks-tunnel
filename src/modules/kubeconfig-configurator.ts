import { execSync } from 'child_process';
import { KubeconfigResult } from '../types.js';

/**
 * Configures kubectl to connect to an EKS cluster through the local tunnel.
 *
 * Uses `kubectl config` commands to create or update cluster, user, and context
 * entries pointing at the localhost tunnel. These commands are idempotent — they
 * create new entries or update existing ones without duplication.
 *
 * @param clusterName - The EKS cluster name used to build the context name
 * @param localPort - The local port the SSM tunnel is listening on
 * @param profile - The AWS CLI profile for token retrieval
 * @param region - The AWS region for token retrieval
 * @returns A KubeconfigResult containing the created/updated context name
 */
export async function configureKubeconfig(
  clusterName: string,
  localPort: number,
  profile: string,
  region: string
): Promise<KubeconfigResult> {
  const contextName = `eks-tunnel-${clusterName}`;

  // Set cluster entry pointing to the local tunnel endpoint
  execSync(
    `kubectl config set-cluster ${contextName} --server=https://localhost:${localPort} --insecure-skip-tls-verify=true`,
    { stdio: 'pipe' }
  );

  // Set user credentials using exec-based token retrieval via aws eks get-token
  execSync(
    [
      'kubectl config set-credentials',
      contextName,
      '--exec-api-version=client.authentication.k8s.io/v1beta1',
      '--exec-command=aws',
      '--exec-arg=eks',
      '--exec-arg=get-token',
      '--exec-arg=--cluster-name',
      `--exec-arg=${clusterName}`,
      '--exec-arg=--profile',
      `--exec-arg=${profile}`,
      '--exec-arg=--region',
      `--exec-arg=${region}`,
    ].join(' '),
    { stdio: 'pipe' }
  );

  // Set context linking the cluster and user entries
  execSync(
    `kubectl config set-context ${contextName} --cluster=${contextName} --user=${contextName}`,
    { stdio: 'pipe' }
  );

  // Set the active context to the newly configured one
  execSync(
    `kubectl config use-context ${contextName}`,
    { stdio: 'pipe' }
  );

  return { contextName };
}
