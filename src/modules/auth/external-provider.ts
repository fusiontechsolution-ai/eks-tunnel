import { execSync } from 'node:child_process';
import { AccountEntry } from '../../types.js';
import { ExitError } from '../../errors.js';
import { EXIT_CODES } from '../../constants.js';

/**
 * Auth provider for external credential providers (e.g., Opal, custom tooling).
 * Executes a configured command with arguments to refresh credentials.
 */
export class ExternalProvider {
  async refresh(account: AccountEntry): Promise<void> {
    if (!account.providerConfig) {
      throw new ExitError(
        EXIT_CODES.AUTH_FAILURE,
        `No providerConfig defined for account "${account.accountName}". ` +
        `Add a providerConfig with "command" and "args" fields to the account entry.`
      );
    }

    const { command, args } = account.providerConfig;

    try {
      execSync(`${command} ${args.join(' ')}`, {
        stdio: ['inherit', 'pipe', 'pipe'],
      });
    } catch (error: unknown) {
      const stderr = (error as { stderr?: Buffer })?.stderr?.toString().trim() || 'Unknown error';
      throw new ExitError(
        EXIT_CODES.AUTH_FAILURE,
        `Provider command failed: ${stderr}`
      );
    }
  }

  getInstructions(account: AccountEntry): string {
    if (!account.providerConfig) {
      return 'No providerConfig defined for this account';
    }
    const { command, args } = account.providerConfig;
    return `${command} ${args.join(' ')}`;
  }
}
