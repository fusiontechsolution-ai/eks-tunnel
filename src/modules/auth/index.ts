import { AccountEntry } from '../../types.js';
import { SsoProvider } from './sso-provider.js';
import { IamProvider } from './iam-provider.js';
import { ExternalProvider } from './external-provider.js';

/**
 * Interface for pluggable authentication providers.
 */
export interface AuthProvider {
  /** Trigger a credential refresh for the given account. */
  refresh(account: AccountEntry): Promise<void>;
  /** Return a human-readable instruction string for refreshing credentials. */
  getInstructions(account: AccountEntry): string;
}

/**
 * Factory function that creates the appropriate auth provider based on the account's auth method.
 */
export function createAuthProvider(method: 'sso' | 'iam' | 'provider'): AuthProvider {
  switch (method) {
    case 'sso':
      return new SsoProvider();
    case 'iam':
      return new IamProvider();
    case 'provider':
      return new ExternalProvider();
  }
}
