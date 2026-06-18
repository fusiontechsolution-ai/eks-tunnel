import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExitError } from '../../src/errors.js';

describe('PlatformDetector', () => {
  describe('detectPlatform', () => {
    let originalPlatform: PropertyDescriptor | undefined;

    beforeEach(() => {
      originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    });

    afterEach(() => {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });

    it('returns "macos" when process.platform is "darwin"', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const { detectPlatform } = await import('../../src/modules/platform-detector.js');
      expect(detectPlatform()).toBe('macos');
    });

    it('returns "linux" when process.platform is "linux"', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const { detectPlatform } = await import('../../src/modules/platform-detector.js');
      expect(detectPlatform()).toBe('linux');
    });

    it('throws ExitError with code 1 for unsupported platform "win32"', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const { detectPlatform } = await import('../../src/modules/platform-detector.js');
      try {
        detectPlatform();
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ExitError);
        const exitErr = err as ExitError;
        expect(exitErr.exitCode).toBe(1);
        expect(exitErr.message).toContain('Unsupported platform');
        expect(exitErr.message).toContain('win32');
        expect(exitErr.message).toContain('macos');
        expect(exitErr.message).toContain('linux');
      }
    });

    it('throws ExitError with code 1 for unsupported platform "freebsd"', async () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      const { detectPlatform } = await import('../../src/modules/platform-detector.js');
      try {
        detectPlatform();
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ExitError);
        const exitErr = err as ExitError;
        expect(exitErr.exitCode).toBe(1);
        expect(exitErr.message).toContain('freebsd');
      }
    });
  });

  describe('isPortInUse', () => {
    let execSyncMock: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      vi.resetModules();
      execSyncMock = vi.fn();
      vi.doMock('child_process', () => ({
        execSync: execSyncMock,
      }));
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('uses lsof on macOS and returns true when port is in use', async () => {
      execSyncMock.mockReturnValue('COMMAND  PID USER');
      const { isPortInUse } = await import('../../src/modules/platform-detector.js');
      const result = await isPortInUse(8443, 'macos');
      expect(result).toBe(true);
      expect(execSyncMock).toHaveBeenCalledWith('lsof -i :8443', { stdio: 'pipe' });
    });

    it('uses lsof on macOS and returns false when port is free', async () => {
      execSyncMock.mockImplementation(() => {
        throw new Error('exit code 1');
      });
      const { isPortInUse } = await import('../../src/modules/platform-detector.js');
      const result = await isPortInUse(8443, 'macos');
      expect(result).toBe(false);
    });

    it('uses ss on Linux and returns true when port is in use', async () => {
      execSyncMock.mockReturnValue(
        'State  Recv-Q Send-Q Local Address:Port\nLISTEN 0      128    0.0.0.0:8443'
      );
      const { isPortInUse } = await import('../../src/modules/platform-detector.js');
      const result = await isPortInUse(8443, 'linux');
      expect(result).toBe(true);
      expect(execSyncMock).toHaveBeenCalledWith(
        'ss -tlnp sport = :8443',
        expect.objectContaining({ stdio: 'pipe', encoding: 'utf-8' })
      );
    });

    it('uses ss on Linux and returns false when port is free', async () => {
      execSyncMock.mockReturnValue('State  Recv-Q Send-Q Local Address:Port\n');
      const { isPortInUse } = await import('../../src/modules/platform-detector.js');
      const result = await isPortInUse(8443, 'linux');
      expect(result).toBe(false);
    });

    it('falls back to lsof on Linux when ss is not available', async () => {
      let callCount = 0;
      execSyncMock.mockImplementation((cmd: string) => {
        callCount++;
        if (cmd.startsWith('ss')) {
          throw new Error('command not found: ss');
        }
        // lsof succeeds — port in use
        return 'COMMAND  PID USER';
      });
      const { isPortInUse } = await import('../../src/modules/platform-detector.js');
      const result = await isPortInUse(9000, 'linux');
      expect(result).toBe(true);
      expect(callCount).toBe(2);
    });

    it('falls back to lsof on Linux when ss fails and lsof shows port free', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd.startsWith('ss')) {
          throw new Error('command not found: ss');
        }
        // lsof also fails — port is free
        throw new Error('exit code 1');
      });
      const { isPortInUse } = await import('../../src/modules/platform-detector.js');
      const result = await isPortInUse(9000, 'linux');
      expect(result).toBe(false);
    });
  });
});
