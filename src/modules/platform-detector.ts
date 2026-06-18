import { execSync } from 'child_process';
import { ExitError } from '../errors.js';
import { EXIT_CODES } from '../constants.js';

/**
 * Supported platform types.
 */
export type Platform = 'macos' | 'linux';

const SUPPORTED_PLATFORMS: Platform[] = ['macos', 'linux'];

/**
 * Detects the current operating system platform.
 * Maps Node.js process.platform values to our supported Platform type.
 *
 * @returns The detected platform ('macos' or 'linux')
 * @throws ExitError with exit code 1 if the platform is unsupported
 */
export function detectPlatform(): Platform {
  const platform = process.platform;

  if (platform === 'darwin') {
    return 'macos';
  }

  if (platform === 'linux') {
    return 'linux';
  }

  throw new ExitError(
    EXIT_CODES.GENERAL_ERROR,
    `Unsupported platform: "${platform}". Supported platforms: ${SUPPORTED_PLATFORMS.join(', ')}`,
    [`This tool only runs on macOS and Linux.`]
  );
}

/**
 * Checks whether a given port is currently in use on the system.
 *
 * On macOS: uses `lsof -i :PORT`
 * On Linux: tries `ss -tlnp` first, falls back to `lsof -i :PORT`
 *
 * @param port - The port number to check
 * @param platform - The current platform
 * @returns true if the port is in use, false otherwise
 */
export async function isPortInUse(port: number, platform: Platform): Promise<boolean> {
  if (platform === 'macos') {
    return checkPortWithLsof(port);
  }

  // Linux: try ss first, fallback to lsof
  return checkPortWithSs(port) ?? checkPortWithLsof(port);
}

/**
 * Checks port usage using lsof command.
 */
function checkPortWithLsof(port: number): boolean {
  try {
    execSync(`lsof -i :${port}`, { stdio: 'pipe' });
    return true;
  } catch {
    // lsof exits non-zero when no process is using the port
    return false;
  }
}

/**
 * Checks port usage using ss command (Linux).
 * Returns null if ss is not available, so caller can fallback.
 */
function checkPortWithSs(port: number): boolean | null {
  try {
    const output = execSync(`ss -tlnp sport = :${port}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    // ss always outputs a header line; if there are additional lines, the port is in use
    const lines = output.trim().split('\n');
    return lines.length > 1;
  } catch {
    // ss command not available or failed — signal caller to fallback
    return null;
  }
}
