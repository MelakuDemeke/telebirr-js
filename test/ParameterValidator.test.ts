import { describe, expect, it } from 'vitest';
import { InvalidParameterError } from '../src/errors/InvalidParameterError.js';
import { ParameterValidator } from '../src/ParameterValidator.js';

describe('ParameterValidator.validateMerchantOrderId', () => {
  it('returns a valid id unchanged', () => {
    expect(ParameterValidator.validateMerchantOrderId('ORDER123')).toBe('ORDER123');
  });

  it('generates an id when null/empty', () => {
    expect(ParameterValidator.validateMerchantOrderId(null)).toMatch(/^[A-Za-z0-9]+$/);
    expect(ParameterValidator.validateMerchantOrderId('')).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('throws on invalid charset by default', () => {
    expect(() => ParameterValidator.validateMerchantOrderId('ORDER_123')).toThrow(InvalidParameterError);
  });

  it('sanitizes when autoSanitize is true', () => {
    expect(ParameterValidator.validateMerchantOrderId('ORDER_123', true)).toBe('ORDER123');
  });

  it('falls back to generated id when sanitization empties the string', () => {
    expect(ParameterValidator.validateMerchantOrderId('___---', true)).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe('ParameterValidator.validateTitle', () => {
  it('trims and returns a clean title', () => {
    expect(ParameterValidator.validateTitle('  Order 123  ')).toBe('Order 123');
  });

  it('auto-sanitizes invalid characters by default', () => {
    expect(ParameterValidator.validateTitle('Order #123!')).toBe('Order 123');
  });

  it('throws on invalid characters when autoSanitize is false', () => {
    expect(() => ParameterValidator.validateTitle('Order #123', false)).toThrow(InvalidParameterError);
  });

  it('throws on empty title', () => {
    expect(() => ParameterValidator.validateTitle('   ')).toThrow(InvalidParameterError);
  });

  it('truncates to 200 characters', () => {
    const long = 'a'.repeat(250);
    expect(ParameterValidator.validateTitle(long)).toHaveLength(200);
  });
});

describe('ParameterValidator.validateAmount', () => {
  it('formats numeric strings to 2 decimals', () => {
    expect(ParameterValidator.validateAmount('10')).toBe('10.00');
    expect(ParameterValidator.validateAmount('10.5')).toBe('10.50');
    expect(ParameterValidator.validateAmount(10)).toBe('10.00');
  });

  it('rejects non-numeric input', () => {
    expect(() => ParameterValidator.validateAmount('abc')).toThrow(InvalidParameterError);
  });

  it('rejects zero and negative amounts', () => {
    expect(() => ParameterValidator.validateAmount('0')).toThrow(InvalidParameterError);
    expect(() => ParameterValidator.validateAmount('-5')).toThrow(InvalidParameterError);
  });

  it('rejects hex/exponential/Infinity strings (unlike bare Number())', () => {
    expect(() => ParameterValidator.validateAmount('0x1A')).toThrow(InvalidParameterError);
    expect(() => ParameterValidator.validateAmount('1e3')).toThrow(InvalidParameterError);
    expect(() => ParameterValidator.validateAmount('Infinity')).toThrow(InvalidParameterError);
  });
});

describe('ParameterValidator.validateUrl', () => {
  it('accepts http(s) URLs', () => {
    expect(ParameterValidator.validateUrl('https://example.com/notify')).toBe('https://example.com/notify');
  });

  it('rejects empty and malformed URLs', () => {
    expect(() => ParameterValidator.validateUrl('')).toThrow(InvalidParameterError);
    expect(() => ParameterValidator.validateUrl('not-a-url')).toThrow(InvalidParameterError);
  });
});

describe('ParameterValidator.isValidMerchantOrderId / generateMerchantOrderId', () => {
  it('round-trips: generated ids are always valid', () => {
    for (let i = 0; i < 20; i++) {
      const id = ParameterValidator.generateMerchantOrderId();
      expect(ParameterValidator.isValidMerchantOrderId(id)).toBe(true);
    }
  });
});
