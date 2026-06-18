import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { progress, result, error } from '../../src/modules/output-formatter.js';

describe('output-formatter', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe('progress', () => {
    it('outputs arrow-prefixed message in normal mode', () => {
      progress('Connecting...', { json: false, quiet: false });
      expect(logSpy).toHaveBeenCalledWith('→ Connecting...');
    });

    it('is a no-op in JSON mode', () => {
      progress('Connecting...', { json: true, quiet: false });
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('is a no-op in quiet mode', () => {
      progress('Connecting...', { json: false, quiet: true });
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when both json and quiet are true', () => {
      progress('Connecting...', { json: true, quiet: true });
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('result', () => {
    it('outputs JSON in JSON mode', () => {
      const data = { contextName: 'my-cluster', port: 8443 };
      result(data, { json: true, quiet: false });
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
    });

    it('outputs contextName in quiet mode when available', () => {
      result({ contextName: 'my-cluster', port: 8443 }, { json: false, quiet: true });
      expect(logSpy).toHaveBeenCalledWith('my-cluster');
    });

    it('outputs first value in quiet mode when contextName is absent', () => {
      result({ port: 8443, host: 'localhost' }, { json: false, quiet: true });
      expect(logSpy).toHaveBeenCalledWith('8443');
    });

    it('outputs key-value pairs in normal mode', () => {
      result({ contextName: 'my-cluster', port: 8443 }, { json: false, quiet: false });
      expect(logSpy).toHaveBeenCalledWith('contextName: my-cluster');
      expect(logSpy).toHaveBeenCalledWith('port: 8443');
    });
  });

  describe('error', () => {
    it('outputs error to stderr', () => {
      error('Something went wrong');
      expect(errorSpy).toHaveBeenCalledWith('✖ Error: Something went wrong');
    });

    it('outputs suggestions when provided', () => {
      error('Auth failed', ['Run aws sso login', 'Check credentials']);
      expect(errorSpy).toHaveBeenCalledWith('✖ Error: Auth failed');
      expect(errorSpy).toHaveBeenCalledWith('  → Run aws sso login');
      expect(errorSpy).toHaveBeenCalledWith('  → Check credentials');
    });

    it('does not output suggestions when not provided', () => {
      error('Something went wrong');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
