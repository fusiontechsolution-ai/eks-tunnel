/**
 * Constructs the SSM session parameters for port forwarding to a remote EKS endpoint.
 */
export interface SsmSessionParams {
  target: string;
  documentName: string;
  parameters: {
    host: string[];
    portNumber: string[];
    localPortNumber: string[];
  };
  profile: string;
  region: string;
}

/**
 * Builds SSM start-session parameters for establishing a port-forwarding tunnel
 * to a private EKS API server through a bastion host.
 *
 * @param eksEndpointUrl - The full HTTPS endpoint URL (e.g., https://ABCDEF.gr7.us-east-1.eks.amazonaws.com)
 * @param bastionId - The EC2 instance ID of the bastion host
 * @param localPort - The local port to forward through
 * @param profile - The AWS profile name
 * @param region - The AWS region
 */
export function buildSsmParameters(
  eksEndpointUrl: string,
  bastionId: string,
  localPort: number,
  profile: string,
  region: string
): SsmSessionParams {
  const host = eksEndpointUrl.replace('https://', '');

  return {
    target: bastionId,
    documentName: 'AWS-StartPortForwardingSessionToRemoteHost',
    parameters: {
      host: [host],
      portNumber: ['443'],
      localPortNumber: [String(localPort)],
    },
    profile,
    region,
  };
}
