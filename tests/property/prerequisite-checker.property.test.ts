import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { ExitError } from '../../src/errors.js';
import { EXIT_CODES } from '../../src/constants.js';

/**
 * Property 15: Missing Prerequisite Error Contains Instructions
 *
 * For any non-empty subset of missing tools from {aws, kubectl, session-manager-plugin, jq},
 * verify error contains each tool's name and install instructions for both macOS and Linux,
 * and exit code is 2.
 *
 * **Validates: Requirements 2.2**
 */

// Mock child_process and platform-detector before importing the module under test
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../src/modules/platform-detector.js', () => ({
  detectPlatform: vi.fn(),
}));

import { checkPrerequisites, PREREQUISITES } from '../../src/modules/prerequisite-checker.js';
import { execSync } from 'child_process';
import { detectPlatform } from '../../src/modules/platform-detector.js';

const mockedExecSync = vi.mocked(execSync);
const mockedDetectPlatform = vi.mocked(detectPlatform);

// Tool names for generating subsets
const ALL_TOOL_NAMES = PREREQUISITES.map((p) => p.name);

describe('Property 15: Missing Prerequisite Error Contains Instructions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('error contains each missing tool name and macOS install instructions, with exit code 2', () => {
    fc.assert(
      fc.property(
        fc.subarray(ALL_TOOL_NAMES, { minLength: 1 }),
        (missingTools) => {
          // Setup: mock platform as macOS
          mockedDetectPlatform.mockReturnValue('macos');

          // Mock execSync to throw for missing tools, succeed for others
          mockedExecSync.mockImplementation((cmd: unknown) => {
            const cmdStr = String(cmd);
            const toolBeingChecked = ALL_TOOL_NAMES.find((tool) =>
              cmdStr.includes(tool)
            );
            if (toolBeingChecked && missingTools.includes(toolBeingChecked)) {
              throw new Error(`command not found: ${toolBeingChecked}`);
            }
            return Buffer.from('');
          });

          // Act & Assert
          try {
            checkPrerequisites(false);
            // Should not reach here since there are missing tools
            expect.fail('Expected ExitError to be thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(ExitError);
            const exitError = err as ExitError;

            // Exit code must be 2 (DEPENDENCY_MISSING)
            expect(exitError.exitCode).toBe(EXIT_CODES.DEPENDENCY_MISSING);

            // Error message must contain each missing tool's name
            for (const toolName of missingTools) {
              expect(exitError.message).toContain(toolName);
            }

            // Error message or suggestions must contain macOS install instructions
            const fullText = exitError.message + (exitError.suggestions?.join(' ') ?? '');
            for (const toolName of missingTools) {
              const prereq = PREREQUISITES.find((p) => p.name === toolName)!;
              expect(fullText).toContain(prereq.macInstall);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('error contains each missing tool name and Linux install instructions, with exit code 2', () => {
    fc.assert(
      fc.property(
        fc.subarray(ALL_TOOL_NAMES, { minLength: 1 }),
        (missingTools) => {
          // Setup: mock platform as Linux
          mockedDetectPlatform.mockReturnValue('linux');

          // Mock execSync to throw for missing tools, succeed for others
          mockedExecSync.mockImplementation((cmd: unknown) => {
            const cmdStr = String(cmd);
            const toolBeingChecked = ALL_TOOL_NAMES.find((tool) =>
              cmdStr.includes(tool)
            );
            if (toolBeingChecked && missingTools.includes(toolBeingChecked)) {
              throw new Error(`command not found: ${toolBeingChecked}`);
            }
            return Buffer.from('');
          });

          // Act & Assert
          try {
            checkPrerequisites(false);
            expect.fail('Expected ExitError to be thrown');
          } catch (err) {
            expect(err).toBeInstanceOf(ExitError);
            const exitError = err as ExitError;

            // Exit code must be 2 (DEPENDENCY_MISSING)
            expect(exitError.exitCode).toBe(EXIT_CODES.DEPENDENCY_MISSING);

            // Error message must contain each missing tool's name
            for (const toolName of missingTools) {
              expect(exitError.message).toContain(toolName);
            }

            // Error message or suggestions must contain Linux install instructions
            const fullText = exitError.message + (exitError.suggestions?.join(' ') ?? '');
            for (const toolName of missingTools) {
              const prereq = PREREQUISITES.find((p) => p.name === toolName)!;
              expect(fullText).toContain(prereq.linuxInstall);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
