import type { OutputOptions } from '../types.js';

/**
 * Display a progress message to the user.
 * No-op in JSON mode or quiet mode.
 */
export function progress(message: string, options: OutputOptions): void {
  if (options.json) return;
  if (options.quiet) return;
  console.log(`→ ${message}`);
}

/**
 * Output structured result data.
 * - JSON mode: outputs JSON.stringify with indentation
 * - Quiet mode: outputs just the most relevant field value
 * - Normal mode: outputs formatted key-value pairs
 */
export function result(data: Record<string, unknown>, options: OutputOptions): void {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (options.quiet) {
    const firstValue = data.contextName ?? Object.values(data)[0] ?? '';
    console.log(String(firstValue));
    return;
  }

  for (const [key, value] of Object.entries(data)) {
    console.log(`${key}: ${value}`);
  }
}

/**
 * Display an error message to stderr with optional suggestions.
 */
export function error(message: string, suggestions?: string[]): void {
  console.error(`✖ Error: ${message}`);
  if (suggestions) {
    for (const suggestion of suggestions) {
      console.error(`  → ${suggestion}`);
    }
  }
}
