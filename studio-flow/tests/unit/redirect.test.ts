import { describe, it, expect } from 'vitest';
import {
  safeNextPath,
  authCallbackUrl,
  DEFAULT_POST_LOGIN_PATH,
} from '@/lib/auth/redirect';

/**
 * The open-redirect control from Basic Security §4.3.
 *
 * These are attack cases, not input-shape cases. Each one is a value that a
 * real open-redirect vulnerability accepts, so a regression here is a live
 * phishing assist rather than a cosmetic bug — which is why they are asserted
 * individually instead of as one loop with a shared message.
 */

describe('safeNextPath — accepts genuine in-app destinations', () => {
  it('accepts a plain path', () => {
    expect(safeNextPath('/my/bookings')).toBe('/my/bookings');
  });
  it('accepts a path with a query string', () => {
    expect(safeNextPath('/schedule?week=2')).toBe('/schedule?week=2');
  });
  it('accepts a deep path', () => {
    const path = '/schedule/11111111-2222-4333-8444-555555555555';
    expect(safeNextPath(path)).toBe(path);
  });
  it('preserves a colon inside the query string', () => {
    expect(safeNextPath('/schedule?at=10:30')).toBe('/schedule?at=10:30');
  });
});

describe('safeNextPath — rejects off-origin destinations', () => {
  it('rejects an absolute http URL', () => {
    expect(safeNextPath('https://evil.example/steal')).toBe(
      DEFAULT_POST_LOGIN_PATH,
    );
  });

  /**
   * THE ONE MOST OFTEN MISSED. '//evil.example' starts with '/', so a check
   * that only tests startsWith('/') lets it straight through — and the browser
   * reads it as a HOST, not a path.
   */
  it('rejects a protocol-relative URL', () => {
    expect(safeNextPath('//evil.example')).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  it('rejects a backslash-normalised protocol-relative URL', () => {
    expect(safeNextPath('/\\evil.example')).toBe(DEFAULT_POST_LOGIN_PATH);
  });
  it('rejects a backslash anywhere in the path', () => {
    expect(safeNextPath('/my\\..\\admin')).toBe(DEFAULT_POST_LOGIN_PATH);
  });
  it('rejects a javascript: scheme', () => {
    expect(safeNextPath('javascript:alert(1)')).toBe(DEFAULT_POST_LOGIN_PATH);
  });
  it('rejects a scheme in the path portion', () => {
    expect(safeNextPath('/redirect:https://evil.example')).toBe(
      DEFAULT_POST_LOGIN_PATH,
    );
  });
  it('rejects a path not anchored at root', () => {
    expect(safeNextPath('evil.example')).toBe(DEFAULT_POST_LOGIN_PATH);
  });
});

describe('safeNextPath — rejects header-splitting and junk', () => {
  it('rejects an embedded CRLF', () => {
    expect(safeNextPath('/schedule\r\nSet-Cookie: a=b')).toBe(
      DEFAULT_POST_LOGIN_PATH,
    );
  });
  it('rejects an embedded newline', () => {
    expect(safeNextPath('/schedule\nX-Injected: 1')).toBe(
      DEFAULT_POST_LOGIN_PATH,
    );
  });
  it('rejects a NUL byte', () => {
    expect(safeNextPath('/schedule\u0000')).toBe(DEFAULT_POST_LOGIN_PATH);
  });
  it('rejects an over-long value', () => {
    expect(safeNextPath(`/${'a'.repeat(600)}`)).toBe(DEFAULT_POST_LOGIN_PATH);
  });
  it('rejects an empty string', () => {
    expect(safeNextPath('')).toBe(DEFAULT_POST_LOGIN_PATH);
  });
  it('rejects a non-string', () => {
    expect(safeNextPath(undefined)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeNextPath(null)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeNextPath(42)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(safeNextPath({ toString: () => '/schedule' })).toBe(
      DEFAULT_POST_LOGIN_PATH,
    );
  });
});

describe('safeNextPath — avoids redirect loops', () => {
  it('rejects /login as a destination', () => {
    expect(safeNextPath('/login')).toBe(DEFAULT_POST_LOGIN_PATH);
  });
  it('rejects /register as a destination', () => {
    expect(safeNextPath('/register')).toBe(DEFAULT_POST_LOGIN_PATH);
  });
  it('honours a caller-supplied fallback', () => {
    expect(safeNextPath('https://evil.example', '')).toBe('');
  });
});

describe('authCallbackUrl — sanitises before embedding', () => {
  it('omits next entirely for a hostile value', () => {
    const url = new URL(authCallbackUrl('//evil.example'));
    expect(url.pathname).toBe('/auth/callback');
    expect(url.searchParams.get('next')).toBeNull();
  });
  it('embeds a legitimate next', () => {
    const url = new URL(authCallbackUrl('/my/bookings'));
    expect(url.searchParams.get('next')).toBe('/my/bookings');
  });
  it('omits next when none is given', () => {
    const url = new URL(authCallbackUrl(undefined));
    expect(url.searchParams.get('next')).toBeNull();
  });
  it('does not double a trailing slash from the configured origin', () => {
    expect(authCallbackUrl(undefined)).toContain('/auth/callback');
    expect(authCallbackUrl(undefined)).not.toContain('//auth/callback');
  });
});
