# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-06-18

### Fixed

- Publish workflow now uses Node 22 (Trusted Publishing requires Node >= 22.14.0, npm CLI >= 11.5.1)
- Removed `--provenance` flag (auto-generated with OIDC)
- Removed `NODE_AUTH_TOKEN` env var (not needed with Trusted Publishing)
- Moved `id-token: write` permission to top-level workflow scope

### Added

- `repository.url` field in package.json (required by npm for OIDC validation)

## [0.1.1] - 2026-06-18

### Changed

- Updated README install commands to use scoped package name `@fusiontechsolution.ai/eks-tunnel`
- Added Changelog section to README linking to CHANGELOG.md and docs/releases/

### Added

- CHANGELOG.md following Keep a Changelog format
- Release notes directory (docs/releases/)
- GitHub Actions CI workflow (Node 18/20/22 matrix)
- GitHub Actions publish workflow with npm provenance and Trusted Publishing
- .gitignore for node_modules, dist, coverage, and editor files
- .npmrc for scoped registry configuration
- MIT LICENSE file

## [0.1.0] - 2026-06-18

### Added

- Initial release of `@fusiontechsolution.ai/eks-tunnel`
- `connect` command — full workflow: prerequisites → registry → resolve → region → endpoint → port → tunnel → kubeconfig → verify
- `status` command — list active tunnels with uptime, auto-clean stale entries
- `stop` / `stop-all` commands — terminate tunnels, clean kubeconfig contexts
- `watch` command — monitor tunnel health every 30s with auto-reconnect (3 retries)
- `refresh` command — proactively refresh credentials for a cluster's account
- `init` command — scaffold starter `~/.eks-tunnel/clusters.json`
- `version` command
- Pluggable authentication: AWS SSO, static IAM, external provider (e.g., Opal)
- Cluster resolution: exact match, substring auto-select, interactive selection via Inquirer.js
- Region inference from cluster name prefix or explicit config field
- Port assignment starting at 8443 with auto-increment on conflict
- SSM port-forwarding via `AWS-StartPortForwardingSessionToRemoteHost`
- Kubeconfig auto-configuration with exec-based token retrieval
- Connection verification via `kubectl get nodes`
- State management at `~/.eks-tunnel/state.json`
- Output modes: human-readable (default), `--json`, `--quiet`
- Exit codes: 0 (success), 1 (general), 2 (dependency), 3 (auth), 4 (timeout), 5 (verify)
- Cross-platform: macOS and Ubuntu/WSL
- `--skip-prereqs` flag to bypass dependency checks
- Property-based test suite (16 properties, fast-check)
- Unit test suite (93 tests, vitest)
- CI workflow (Node 18/20/22 matrix)
- Publish workflow (on GitHub Release → npm)

[0.1.2]: https://github.com/fusiontechsolution-ai/eks-tunnel/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/fusiontechsolution-ai/eks-tunnel/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/fusiontechsolution-ai/eks-tunnel/releases/tag/v0.1.0
