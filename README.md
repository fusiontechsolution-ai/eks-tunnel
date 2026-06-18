# eks-tunnel

A globally-installable CLI tool that establishes SSM port-forwarding tunnels to private EKS clusters through bastion hosts. One command to connect, kubectl is ready.

```bash
npm install -g eks-tunnel
eks-tunnel connect my-cluster
```

## Features

- **One-command connect** — handles credentials, endpoint discovery, SSM tunneling, and kubectl config
- **Pluggable auth** — supports AWS SSO, static IAM credentials, and external providers
- **Multiple tunnels** — connect to several clusters simultaneously on different local ports
- **Watch mode** — auto-reconnects dropped tunnels with credential refresh
- **Cross-platform** — macOS and Ubuntu/WSL
- **Scriptable** — `--json` and `--quiet` flags for automation, structured exit codes

## Prerequisites

| Tool | macOS | Linux |
|------|-------|-------|
| AWS CLI v2 | `brew install awscli` | [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) |
| kubectl | `brew install kubectl` | `sudo apt-get install -y kubectl` |
| session-manager-plugin | `brew install --cask session-manager-plugin` | [Install guide](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html) |
| jq | `brew install jq` | `sudo apt-get install -y jq` |

## Quick Start

```bash
# Install globally
npm install -g eks-tunnel

# Create a starter config
eks-tunnel init

# Edit ~/.eks-tunnel/clusters.json with your cluster details
# Then connect:
eks-tunnel connect eu-west-1-my-cluster
```

## Configuration

The cluster registry lives at `~/.eks-tunnel/clusters.json` (override with `--config` or `EKS_TUNNEL_CONFIG` env var):

```json
{
  "accounts": [
    {
      "accountId": "123456789012",
      "accountName": "my-production",
      "profile": "my-aws-profile",
      "authMethod": "sso",
      "clusters": [
        {
          "name": "eu-west-1-my-cluster",
          "bastionInstanceId": "i-0abc123def456",
          "region": "eu-west-1"
        }
      ]
    }
  ]
}
```

### Auth Methods

| Method | `authMethod` value | Behavior |
|--------|-------------------|----------|
| AWS SSO | `"sso"` (default) | Uses profile SSO session; prompts `aws sso login` on expiry |
| Static IAM | `"iam"` | Uses credentials from `~/.aws/credentials` |
| External provider | `"provider"` | Runs a configured command to refresh credentials |

External provider example:

```json
{
  "authMethod": "provider",
  "providerConfig": {
    "command": "my-security-tool",
    "args": ["iam-roles:start", "--id", "role-uuid", "--profileName", "my-profile"]
  }
}
```

## Commands

### connect

```bash
eks-tunnel connect [cluster-name] [options]

Options:
  -c, --config <path>   Path to cluster registry config
  -p, --port <number>   Local port (default: auto from 8443)
  --json                Output as JSON
  --quiet               Suppress progress messages
  --skip-prereqs        Skip prerequisite checks
  --watch               Enter watch mode after connecting
```

### status

```bash
eks-tunnel status [--json]
```

Lists active tunnels with cluster name, account, region, port, PID, and uptime.

### stop / stop-all

```bash
eks-tunnel stop <cluster-name>   # Stop one tunnel
eks-tunnel stop-all              # Stop all tunnels
```

Terminates the SSM process, removes the kubeconfig context, and cleans state.

### watch

```bash
eks-tunnel watch <cluster-name>
```

Monitors an active tunnel every 30s. Auto-reconnects on failure (up to 3 retries).

### refresh

```bash
eks-tunnel refresh <cluster-name>
```

Proactively refreshes credentials for the cluster's account.

### init

```bash
eks-tunnel init
```

Creates a starter `~/.eks-tunnel/clusters.json` with placeholder values.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error (config missing, parse error, no match) |
| 2 | Missing dependency |
| 3 | Authentication failure |
| 4 | Tunnel timeout |
| 5 | Connection verification failed |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run all tests
npm test

# Run property-based tests only
npm run test:property
```

### Project Structure

```
src/
├── cli.ts                     # Commander.js entry point
├── types.ts                   # Shared interfaces
├── errors.ts                  # ExitError class
├── constants.ts               # Exit codes, defaults
└── modules/
    ├── auth/                  # SSO, IAM, external providers
    ├── platform-detector.ts
    ├── prerequisite-checker.ts
    ├── registry-loader.ts
    ├── cluster-resolver.ts
    ├── region-inferrer.ts
    ├── endpoint-discoverer.ts
    ├── port-assigner.ts
    ├── tunnel-establisher.ts
    ├── kubeconfig-configurator.ts
    ├── connection-verifier.ts
    ├── state-manager.ts
    └── output-formatter.ts

tests/
├── unit/                      # Example-based unit tests
└── property/                  # Property-based tests (fast-check)
```

## How It Works

1. Verifies prerequisites (aws, kubectl, session-manager-plugin, jq)
2. Loads and validates the cluster registry
3. Resolves the cluster (exact match, substring, or interactive selection)
4. Infers the AWS region from the cluster name or config
5. Discovers the EKS API endpoint via `aws eks describe-cluster`
6. Assigns a free local port (starting at 8443)
7. Establishes an SSM port-forwarding session through the bastion
8. Configures kubectl with a context pointing to `localhost:<port>`
9. Verifies connectivity with `kubectl get nodes`

## License

MIT
