import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExitError } from '../../src/errors.js';
import { EXIT_CODES } from '../../src/constants.js';

describe('PrerequisiteChecker', () => {
  let execSyncMock: ReturnType<typeof vi.fn>;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.resetModules();
    execSyncMock = vi.fn();
    vi.doMock('child_process', () => ({
      execSync: execSyncMock,
    }));
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    // Default to macOS for tests
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  describe('checkPrerequisites', () => {
    it('does nothing when skip is true', async () => {
      const { checkPrerequisites } = await import('../../src/modules/prerequisite-checker.js');
      // Should not throw regardless of system state
      expect(() => checkPrerequisites(true)).not.toThrow();
      expect(execSyncMock).not.toHaveBeenCalled();
    });

    it('passes when all tools are found', async () => {
      execSyncMock.mockReturnValue('/usr/local/bin/tool');
      const { checkPrerequisites } = await import('../../src/modules/prerequisite-checker.js');
      expect(() => checkPrerequisites(false)).not.toThrow();
      // Should have checked all 4 prerequisites
      expect(execSyncMock).toHaveBeenCalledTimes(4);
    });

    it('throws ExitError with code 2 when aws is missing', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v aws') {
          throw new Error('not found');
        }
        return '/usr/local/bin/tool';
      });
      const { checkPrerequisites } = await import('../../src/modules/prerequisite-checker.js');
      try {
        checkPrerequisites(false);
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.name).toBe('ExitError');
        expect(err.exitCode).toBe(EXIT_CODES.DEPENDENCY_MISSING);
        expect(err.message).toContain('aws');
        expect(err.message).toContain('brew install awscli');
      }
    });

    it('throws ExitError with code 2 when multiple tools are missing', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v aws' || cmd === 'command -v jq') {
          throw new Error('not found');
        }
        return '/usr/local/bin/tool';
      });
      const { checkPrerequisites } = await import('../../src/modules/prerequisite-checker.js');
      try {
        checkPrerequisites(false);
        expect.fail('should have thrown');
      } catch (err: any) {
        expect(err.name).toBe('ExitError');
        expect(err.exitCode).toBe(EXIT_CODES.DEPENDENCY_MISSING);
        expect(err.message).toContain('aws');
        expect(err.message).toContain('jq');
      }
    });

    it('includes macOS install instructions on darwin', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v kubectl') {
          throw new Error('not found');
        }
        return '/usr/local/bin/tool';
      });
      const { checkPrerequisites } = await import('../../src/modules/prerequisite-checker.js');
      try {
        checkPrerequisites(false);
        expect.fail('should have thrown');
      } catch (err) {
        const exitErr = err as ExitError;
        expect(exitErr.message).toContain('brew install kubectl');
        expect(exitErr.message).toContain('macos');
      }
    });

    it('includes Linux install instructions on linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v kubectl') {
          throw new Error('not found');
        }
        return '/usr/local/bin/tool';
      });
      const { checkPrerequisites } = await import('../../src/modules/prerequisite-checker.js');
      try {
        checkPrerequisites(false);
        expect.fail('should have thrown');
      } catch (err) {
        const exitErr = err as ExitError;
        expect(exitErr.message).toContain('sudo apt-get install -y kubectl');
        expect(exitErr.message).toContain('linux');
      }
    });

    it('includes session-manager-plugin Linux instructions with URL', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v session-manager-plugin') {
          throw new Error('not found');
        }
        return '/usr/local/bin/tool';
      });
      const { checkPrerequisites } = await import('../../src/modules/prerequisite-checker.js');
      try {
        checkPrerequisites(false);
        expect.fail('should have thrown');
      } catch (err) {
        const exitErr = err as ExitError;
        expect(exitErr.message).toContain('session-manager-plugin');
        expect(exitErr.message).toContain('https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html');
      }
    });

    it('provides suggestions array with install instructions', async () => {
      execSyncMock.mockImplementation((cmd: string) => {
        if (cmd === 'command -v jq') {
          throw new Error('not found');
        }
        return '/usr/local/bin/tool';
      });
      const { checkPrerequisites } = await import('../../src/modules/prerequisite-checker.js');
      try {
        checkPrerequisites(false);
        expect.fail('should have thrown');
      } catch (err) {
        const exitErr = err as ExitError;
        expect(exitErr.suggestions).toBeDefined();
        expect(exitErr.suggestions!.length).toBeGreaterThan(0);
        expect(exitErr.suggestions![0]).toContain('Install jq');
      }
    });
  });

  describe('PREREQUISITES constant', () => {
    it('exports the prerequisites array with all 4 required tools', async () => {
      const { PREREQUISITES } = await import('../../src/modules/prerequisite-checker.js');
      expect(PREREQUISITES).toHaveLength(4);
      const names = PREREQUISITES.map((p) => p.name);
      expect(names).toContain('aws');
      expect(names).toContain('kubectl');
      expect(names).toContain('session-manager-plugin');
      expect(names).toContain('jq');
    });

    it('each prerequisite has macInstall and linuxInstall instructions', async () => {
      const { PREREQUISITES } = await import('../../src/modules/prerequisite-checker.js');
      for (const prereq of PREREQUISITES) {
        expect(prereq.macInstall).toBeTruthy();
        expect(prereq.linuxInstall).toBeTruthy();
        expect(prereq.command).toBeTruthy();
      }
    });
  });
});
