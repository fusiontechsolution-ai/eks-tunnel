/**
 * Custom error class that carries an exit code and optional suggestions
 * for the user to resolve the issue.
 */
export class ExitError extends Error {
  constructor(
    public readonly exitCode: number,
    message: string,
    public readonly suggestions?: string[]
  ) {
    super(message);
    this.name = 'ExitError';
  }
}
