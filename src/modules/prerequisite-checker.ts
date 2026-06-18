import { execSync } from 'child_process';
import { ExitError } from '../errors.js';
import { EXIT_CODES } from '../constants.js';
import { detectPlatform, Platform } from './platform-detector.js';

/**
 * Defines a prerequisite tool that must be present on the system.
 */
export interface Prerequisite {
  name: string;
  command: string;
  macInstall: string;
  linuxInstall: string;
}

/**
 * All prerequisite tools required for eks-tunnel to function.
 */
export const PREREQUISITES: Prerequisite[] = [
  {
    name: 'aws',
    command: 'aws',
    macInstall: 'brew install awscli',
    linuxInstall:
      "curl 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' -o 'awscliv2.zip' && unzip awscliv2.zip && sudo ./aws/install",
  },
  {
    name: 'kubectl',
    command: 'kubectl',
    macInstall: 'brew install kubectl',
    linuxInstall: 'sudo apt-get install -y kubectl',
  },
  {
    name: 'session-manager-plugin',
    command: 'session-manager-plugin',
    macInstall: 'brew install --cask session-manager-plugin',
    linuxInstall:
      'See https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html',
  },
  {
    name: 'jq',
    command: 'jq',
    macInstall: 'brew install jq',
    linuxInstall: 'sudo apt-get install -y jq',
  },
];

/**
 * Checks whether a command exists on the system.
 *
 * @param command - The command name to look up
 * @returns true if the command is found, false otherwise
 */
function commandExists(command: string): boolean {
  try {
    execSync(`command -v ${command}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the platform-specific install instruction for a prerequisite.
 */
function getInstallInstruction(prereq: Prerequisite, platform: Platform): string {
  return platform === 'macos' ? prereq.macInstall : prereq.linuxInstall;
}

/**
 * Checks that all required prerequisite tools are installed on the system.
 * If `skip` is true, all checks are bypassed (used with --skip-prereqs flag).
 *
 * @param skip - Whether to bypass prerequisite checks
 * @throws ExitError with exit code 2 if any prerequisite is missing
 */
export function checkPrerequisites(skip: boolean): void {
  if (skip) {
    return;
  }

  const platform = detectPlatform();
  const missing: Prerequisite[] = [];

  for (const prereq of PREREQUISITES) {
    if (!commandExists(prereq.command)) {
      missing.push(prereq);
    }
  }

  if (missing.length > 0) {
    const missingNames = missing.map((p) => p.name).join(', ');
    const instructions = missing
      .map((p) => `  • ${p.name}: ${getInstallInstruction(p, platform)}`)
      .join('\n');

    throw new ExitError(
      EXIT_CODES.DEPENDENCY_MISSING,
      `Missing required tools: ${missingNames}\n\nInstall instructions (${platform}):\n${instructions}`,
      missing.map((p) => `Install ${p.name}: ${getInstallInstruction(p, platform)}`)
    );
  }
}
