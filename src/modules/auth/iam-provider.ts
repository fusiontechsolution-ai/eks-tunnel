import { AccountEntry } from '../../types.js';

/**
 * Auth provider for static IAM credentials stored in ~/.aws/credentials.
 * Static credentials cannot be automatically refreshed — the user must rotate them manually.
 */
export class IamProvider {
  async refresh(account: AccountEntry): Promise<void> {
    console.error(
      `Static IAM credentials for profile "${account.profile}" cannot be refreshed automatically.\n` +
      `Please rotate your credentials manually in ~/.aws/credentials.`
    );
  }

  getInstructions(account: AccountEntry): string {
    return `Manually rotate IAM credentials for profile "${account.profile}" in ~/.aws/credentials`;
  }
}
