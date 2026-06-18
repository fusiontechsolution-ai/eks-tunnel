import { AccountEntry } from '../../types.js';

/**
 * Auth provider for AWS SSO-based authentication.
 * Guides the user to run `aws sso login` to refresh their SSO session.
 */
export class SsoProvider {
  async refresh(account: AccountEntry): Promise<void> {
    const command = `aws sso login --profile ${account.profile}`;
    console.error(`SSO credentials expired. Please run:\n\n  ${command}\n`);
  }

  getInstructions(account: AccountEntry): string {
    return `aws sso login --profile ${account.profile}`;
  }
}
