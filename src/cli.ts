#!/usr/bin/env node

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { ExitError } from './errors.js';
import { checkPrerequisites } from './modules/prerequisite-checker.js';
import { resolveConfigPath, loadRegistry } from './modules/registry-loader.js';
import { resolveCluster } from './modules/cluster-resolver.js';
import { inferRegion } from './modules/region-inferrer.js';
import { discoverEndpoint } from './modules/endpoint-discoverer.js';
import { assignPort } from './modules/port-assigner.js';
import { establishTunnel } from './modules/tunnel-establisher.js';
import { configureKubeconfig } from './modules/kubeconfig-configurator.js';
import { verifyConnection } from './modules/connection-verifier.js';
import { readState, addTunnel, cleanStaleTunnels, removeTunnel, writeState } from './modules/state-manager.js';
import { progress, result, error } from './modules/output-formatter.js';
import { DEFAULT_STATE_PATH } from './constants.js';
import { createAuthProvider } from './modules/auth/index.js';
import { detectPlatform, isPortInUse } from './modules/platform-detector.js';
import type { OutputOptions, TunnelEntry } from './types.js';

/**
 * Calculates a human-readable uptime string from an ISO timestamp.
 */
export function calculateUptime(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  let diffMs = now - start;

  if (diffMs < 0 || isNaN(diffMs)) {
    return '0m';
  }

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  diffMs -= days * 1000 * 60 * 60 * 24;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  diffMs -= hours * 1000 * 60 * 60;
  const minutes = Math.floor(diffMs / (1000 * 60));

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(' ');
}

const program = new Command();

program
  .name('eks-tunnel')
  .description('CLI tool to establish SSM port-forwarding tunnels to private EKS clusters')
  .version('0.1.1');

program
  .command('connect [cluster-name]')
  .description('Connect to a private EKS cluster via SSM tunnel')
  .option('-c, --config <path>', 'Path to cluster registry config file')
  .option('-p, --port <number>', 'Local port to use for the tunnel', parseInt)
  .option('--json', 'Output results in JSON format')
  .option('--quiet', 'Suppress progress output')
  .option('--skip-prereqs', 'Skip prerequisite checks')
  .option('--watch', 'Enter watch mode after connection')
  .action(async (clusterName: string | undefined, options: {
    config?: string;
    port?: number;
    json?: boolean;
    quiet?: boolean;
    skipPrereqs?: boolean;
    watch?: boolean;
  }) => {
    const outputOptions: OutputOptions = {
      json: options.json ?? false,
      quiet: options.quiet ?? false,
    };

    try {
      // Step 1: Check prerequisites
      progress('Checking prerequisites', outputOptions);
      checkPrerequisites(options.skipPrereqs ?? false);

      // Step 2: Load cluster registry
      progress('Loading cluster registry', outputOptions);
      const configPath = resolveConfigPath(options.config);
      const registry = loadRegistry(configPath);

      // Step 3: Resolve cluster
      progress('Resolving cluster', outputOptions);
      const resolved = await resolveCluster(clusterName, registry, process.stdin.isTTY ?? false);

      // Step 4: Infer region
      progress('Inferring region', outputOptions);
      const region = await inferRegion(resolved.cluster, process.stdin.isTTY ?? false);

      // Step 5: Discover EKS endpoint
      progress('Discovering EKS endpoint', outputOptions);
      const endpoint = await discoverEndpoint(
        resolved.cluster.name,
        resolved.account.profile,
        region,
        resolved.account
      );

      // Step 6: Assign local port
      progress('Assigning local port', outputOptions);
      const state = readState(DEFAULT_STATE_PATH);
      const port = await assignPort(options.port, state);

      // Step 7: Establish SSM tunnel
      progress('Establishing SSM tunnel', outputOptions);
      const tunnelResult = await establishTunnel(
        resolved.cluster.bastionInstanceId,
        endpoint.host,
        port,
        resolved.account.profile,
        region
      );

      // Step 8: Save tunnel state
      const tunnelEntry: TunnelEntry = {
        clusterName: resolved.cluster.name,
        accountName: resolved.account.accountName,
        accountId: resolved.account.accountId,
        profile: resolved.account.profile,
        region,
        localPort: tunnelResult.localPort,
        pid: tunnelResult.pid,
        endpoint: endpoint.url,
        bastionId: resolved.cluster.bastionInstanceId,
        contextName: `eks-tunnel-${resolved.cluster.name}`,
        startedAt: new Date().toISOString(),
      };
      addTunnel(DEFAULT_STATE_PATH, tunnelEntry);

      // Step 9: Configure kubeconfig
      progress('Configuring kubeconfig', outputOptions);
      const kubeconfigResult = await configureKubeconfig(
        resolved.cluster.name,
        port,
        resolved.account.profile,
        region
      );

      // Step 10: Verify connection
      progress('Verifying connection', outputOptions);
      const verification = await verifyConnection(kubeconfigResult.contextName);

      // Output success result
      result({
        status: 'connected',
        cluster: resolved.cluster.name,
        account: resolved.account.accountName,
        region,
        localPort: tunnelResult.localPort,
        context: kubeconfigResult.contextName,
        nodes: verification.nodeCount,
        pid: tunnelResult.pid,
        example: `kubectl get pods --context ${kubeconfigResult.contextName}`,
      }, outputOptions);

      // Step 11: Enter watch mode if requested
      if (options.watch) {
        progress('Entering watch mode (Ctrl+C to exit)', outputOptions);
        // Watch mode will be fully implemented in a later task
        // For now, keep the process alive and the user can Ctrl+C
      }
    } catch (err) {
      if (err instanceof ExitError) {
        error(err.message, err.suggestions);
        process.exit(err.exitCode);
      }
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('List active tunnel sessions')
  .option('--json', 'Output status in JSON format')
  .action(async (options: { json?: boolean }) => {
    try {
      // Clean stale tunnels first
      const stale = cleanStaleTunnels(DEFAULT_STATE_PATH);
      if (stale.length > 0) {
        console.log(`Removed ${stale.length} stale tunnel(s)`);
      }

      // Read current state
      const state = readState(DEFAULT_STATE_PATH);

      if (state.tunnels.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ tunnels: [] }, null, 2));
        } else {
          console.log('No active tunnels');
        }
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(state, null, 2));
        return;
      }

      // Human-readable output
      console.log(`Active tunnels (${state.tunnels.length}):\n`);
      for (const tunnel of state.tunnels) {
        const uptime = calculateUptime(tunnel.startedAt);
        console.log(`  ${tunnel.clusterName}`);
        console.log(`    Account:  ${tunnel.accountName}`);
        console.log(`    Region:   ${tunnel.region}`);
        console.log(`    Port:     ${tunnel.localPort}`);
        console.log(`    PID:      ${tunnel.pid}`);
        console.log(`    Uptime:   ${uptime}`);
        console.log(`    Context:  ${tunnel.contextName}`);
        console.log('');
      }
    } catch (err) {
      if (err instanceof ExitError) {
        error(err.message, err.suggestions);
        process.exit(err.exitCode);
      }
      error(String(err));
      process.exit(1);
    }
  });

program
  .command('stop <cluster-name>')
  .description('Stop a tunnel for a specific cluster')
  .action(async (clusterName: string) => {
    try {
      const state = readState(DEFAULT_STATE_PATH);
      const entry = state.tunnels.find(t => t.clusterName === clusterName);
      if (!entry) {
        error(`No active tunnel found for cluster '${clusterName}'`);
        process.exit(1);
      }

      // Terminate the process
      try { process.kill(entry.pid, 'SIGTERM'); } catch { /* already dead */ }

      // Remove kubeconfig context
      try {
        execSync(`kubectl config delete-context ${entry.contextName}`, { stdio: 'pipe' });
        execSync(`kubectl config delete-cluster ${entry.contextName}`, { stdio: 'pipe' });
        execSync(`kubectl config delete-user ${entry.contextName}`, { stdio: 'pipe' });
      } catch { /* ignore if context doesn't exist */ }

      // Remove from state
      removeTunnel(DEFAULT_STATE_PATH, clusterName);

      console.log(`Stopped tunnel for ${clusterName} (PID ${entry.pid})`);
    } catch (err) {
      if (err instanceof ExitError) { error(err.message, err.suggestions); process.exit(err.exitCode); }
      error(String(err)); process.exit(1);
    }
  });

program
  .command('stop-all')
  .description('Stop all active tunnels')
  .action(async () => {
    try {
      const state = readState(DEFAULT_STATE_PATH);

      if (state.tunnels.length === 0) {
        console.log('No active tunnels to stop');
        return;
      }

      for (const entry of state.tunnels) {
        try { process.kill(entry.pid, 'SIGTERM'); } catch { /* already dead */ }
        try {
          execSync(`kubectl config delete-context ${entry.contextName}`, { stdio: 'pipe' });
          execSync(`kubectl config delete-cluster ${entry.contextName}`, { stdio: 'pipe' });
          execSync(`kubectl config delete-user ${entry.contextName}`, { stdio: 'pipe' });
        } catch { /* ignore */ }
      }

      // Clear all state
      writeState(DEFAULT_STATE_PATH, { tunnels: [] });

      console.log(`Stopped ${state.tunnels.length} tunnel(s)`);
    } catch (err) {
      if (err instanceof ExitError) { error(err.message, err.suggestions); process.exit(err.exitCode); }
      error(String(err)); process.exit(1);
    }
  });

program
  .command('init')
  .description('Create a starter cluster registry configuration file')
  .action(async () => {
    const configPath = resolveConfigPath();
    const dir = path.dirname(configPath);

    // Check if file already exists
    if (fs.existsSync(configPath)) {
      if (process.stdin.isTTY) {
        const answers = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: `Config file already exists at ${configPath}. Overwrite?`,
        }] as any);
        if (!answers.confirm) {
          console.log('Cancelled.');
          return;
        }
      } else {
        console.error(`Config file already exists at ${configPath}. Use --config to specify a different path.`);
        process.exit(1);
      }
    }

    // Create directory if needed
    fs.mkdirSync(dir, { recursive: true });

    // Write starter config
    const starterConfig = {
      accounts: [{
        accountId: "123456789012",
        accountName: "my-production",
        profile: "my-aws-profile",
        authMethod: "sso",
        clusters: [{
          name: "eu-west-1-my-cluster",
          bastionInstanceId: "i-0abc123def456",
          region: "eu-west-1"
        }]
      }]
    };

    fs.writeFileSync(configPath, JSON.stringify(starterConfig, null, 2));
    console.log(`Created starter config at ${configPath}`);
    console.log('Edit this file with your cluster details, then run: eks-tunnel connect');
  });

program
  .command('watch <cluster-name>')
  .description('Enter watch mode for an existing active tunnel')
  .action(async (clusterName: string) => {
    try {
      const state = readState(DEFAULT_STATE_PATH);
      const entry = state.tunnels.find(t => t.clusterName === clusterName);
      if (!entry) {
        error(`No active tunnel found for cluster '${clusterName}'`);
        process.exit(1);
      }

      console.log(`Watching tunnel for ${clusterName} (PID ${entry.pid}, port ${entry.localPort})...`);
      console.log('Press Ctrl+C to exit watch mode.\n');

      let consecutiveFailures = 0;
      const MAX_FAILURES = 3;

      const interval = setInterval(async () => {
        // Check PID alive
        let alive = false;
        try { process.kill(entry.pid, 0); alive = true; } catch { alive = false; }

        // Check port responsive
        const platform = detectPlatform();
        const portReady = await isPortInUse(entry.localPort, platform);

        if (alive && portReady) {
          consecutiveFailures = 0;
          return; // Healthy
        }

        consecutiveFailures++;
        console.log(`[${new Date().toISOString()}] Health check failed (${consecutiveFailures}/${MAX_FAILURES})`);

        if (consecutiveFailures >= MAX_FAILURES) {
          clearInterval(interval);
          error(`Tunnel for ${clusterName} failed ${MAX_FAILURES} consecutive health checks. Stopping watch mode.`);
          process.exit(1);
        }

        // Attempt reconnection
        console.log('Attempting to re-establish tunnel...');
        try {
          // Try auth refresh first
          const registryPath = resolveConfigPath();
          const registry = loadRegistry(registryPath);
          // Find the account for this cluster
          const account = registry.accounts.find(a =>
            a.clusters.some(c => c.name === clusterName)
          );
          if (account) {
            const authMethod = account.authMethod || 'sso';
            const provider = createAuthProvider(authMethod);
            await provider.refresh(account);
          }

          // Attempt to re-establish
          const tunnelResult = await establishTunnel(
            entry.bastionId,
            new URL(entry.endpoint).host,
            entry.localPort,
            entry.profile,
            entry.region
          );

          // Update state with new PID
          entry.pid = tunnelResult.pid;
          removeTunnel(DEFAULT_STATE_PATH, clusterName);
          addTunnel(DEFAULT_STATE_PATH, entry);
          console.log(`Tunnel re-established (new PID: ${tunnelResult.pid})`);
          consecutiveFailures = 0;
        } catch (reconnectErr) {
          console.error(`Reconnection attempt failed: ${reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr)}`);
        }
      }, 30_000);
    } catch (err) {
      if (err instanceof ExitError) { error(err.message, err.suggestions); process.exit(err.exitCode); }
      error(String(err)); process.exit(1);
    }
  });

program
  .command('refresh <cluster-name>')
  .description('Refresh credentials for a cluster account')
  .action(async (clusterName: string) => {
    try {
      const configPath = resolveConfigPath();
      const registry = loadRegistry(configPath);

      // Find the account containing this cluster
      const account = registry.accounts.find(a =>
        a.clusters.some(c => c.name === clusterName)
      );
      if (!account) {
        error(`No cluster '${clusterName}' found in registry`);
        process.exit(1);
      }

      const authMethod = account.authMethod || 'sso';
      const provider = createAuthProvider(authMethod);

      console.log(`Refreshing credentials for ${clusterName} (${account.accountName}, method: ${authMethod})...`);
      await provider.refresh(account);
      console.log('Credential refresh complete.');
    } catch (err) {
      if (err instanceof ExitError) { error(err.message, err.suggestions); process.exit(err.exitCode); }
      error(String(err)); process.exit(1);
    }
  });

program
  .command('version')
  .description('Display the installed version')
  .action(() => {
    console.log(program.version());
  });

program.parse(process.argv);
