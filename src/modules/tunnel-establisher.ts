import { spawn } from 'child_process';
import * as net from 'net';
import { TunnelResult } from '../types.js';
import { ExitError } from '../errors.js';
import { EXIT_CODES } from '../constants.js';

/** Interval between port readiness checks in milliseconds. */
const POLL_INTERVAL_MS = 500;

/** Maximum time to wait for the tunnel to become ready in milliseconds. */
const POLL_TIMEOUT_MS = 10_000;

/**
 * Checks if a port is ready by attempting a TCP connection to localhost.
 *
 * @param port - The local port number to check
 * @returns A promise that resolves to true if port is accepting connections, false otherwise
 */
function checkPortReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    // Timeout the connection attempt quickly
    socket.setTimeout(400, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Polls a local port for readiness at a fixed interval until the port
 * is accepting connections or the timeout is exceeded.
 *
 * @param port - The local port to poll
 * @param intervalMs - Milliseconds between poll attempts
 * @param timeoutMs - Maximum total milliseconds to wait
 * @returns A promise that resolves to true if port became ready, false on timeout
 */
async function pollPortReady(
  port: number,
  intervalMs: number = POLL_INTERVAL_MS,
  timeoutMs: number = POLL_TIMEOUT_MS
): Promise<boolean> {
  const maxAttempts = Math.ceil(timeoutMs / intervalMs);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ready = await checkPortReady(port);
    if (ready) {
      return true;
    }
    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return false;
}

/**
 * Establishes an SSM port-forwarding tunnel to a remote EKS cluster
 * through a bastion host.
 *
 * Spawns `aws ssm start-session` as a detached background process that
 * forwards traffic from localhost:localPort to the EKS API server on port 443.
 * Polls the local port for readiness and returns the child process PID on success.
 *
 * @param bastionId - The EC2 instance ID of the bastion host (SSM target)
 * @param eksHost - The EKS API server hostname (without https:// prefix)
 * @param localPort - The local port to forward through
 * @param profile - The AWS CLI profile to use
 * @param region - The AWS region
 * @returns A TunnelResult containing the PID and local port
 * @throws ExitError with exit code 4 if the tunnel does not become ready within the timeout
 */
export async function establishTunnel(
  bastionId: string,
  eksHost: string,
  localPort: number,
  profile: string,
  region: string
): Promise<TunnelResult> {
  const args = [
    'ssm',
    'start-session',
    '--target', bastionId,
    '--document-name', 'AWS-StartPortForwardingSessionToRemoteHost',
    '--parameters', `host=${eksHost},portNumber=443,localPortNumber=${localPort}`,
    '--profile', profile,
    '--region', region,
  ];

  const child = spawn('aws', args, {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Collect stdout/stderr for debug output on failure
  let stdout = '';
  let stderr = '';

  child.stdout?.on('data', (data: Buffer) => {
    stdout += data.toString();
  });

  child.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  // Handle spawn errors (e.g., aws command not found)
  const spawnError = await new Promise<Error | null>((resolve) => {
    child.on('error', (err) => resolve(err));
    // Give a brief moment for spawn errors to surface
    setTimeout(() => resolve(null), 100);
  });

  if (spawnError) {
    throw new ExitError(
      EXIT_CODES.TUNNEL_TIMEOUT,
      `Failed to spawn SSM session: ${spawnError.message}`,
      ['Ensure the AWS CLI is installed and on your PATH.']
    );
  }

  // Poll for port readiness
  const ready = await pollPortReady(localPort);

  if (!ready) {
    // Kill the process group (detached process)
    try {
      if (child.pid) {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch {
      // Process may have already exited
    }

    const ssmOutput = [stdout, stderr].filter(Boolean).join('\n').trim();
    const debugInfo = ssmOutput
      ? `\nSSM session output:\n${ssmOutput}`
      : '';

    throw new ExitError(
      EXIT_CODES.TUNNEL_TIMEOUT,
      `Tunnel did not become ready within ${POLL_TIMEOUT_MS / 1000} seconds.${debugInfo}`,
      [
        'Check that the bastion instance is running and accessible via SSM.',
        'Verify your AWS credentials are valid for the specified profile.',
        'Ensure the SSM session manager plugin is installed.',
      ]
    );
  }

  // Unref the child so the CLI can exit while the tunnel persists
  child.unref();

  return {
    pid: child.pid!,
    localPort,
  };
}
