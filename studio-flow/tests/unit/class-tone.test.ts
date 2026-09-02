import { describe, it, expect } from 'vitest';
import {
  assignClassTones,
  toneFor,
  hueOf,
  CLASS_TONES,
  NEUTRAL_TONE,
} from '@/lib/design/class-tone';

/**
 * tests/unit/class-tone.test.ts
 *
 * Colour-coding is only useful if it is STABLE. A class type that is green on
 * one screen and blue on the next is worse than no colour at all, because the
 * user has already learned to trust it. These tests pin the two properties that
 * stability depends on — determinism and collision handling — since both are
 * easy to break with a well-meaning refactor and neither is visible in a
 * screenshot of a single week.
 */

// The studio's real stored colours.
const VINYASA = { id: 'vinyasa', color: '#6366f1' }; // indigo, hue ~239
const REFORMER = { id: 'reformer', color: '#0ea5e9' }; // sky,    hue ~199
const PRENATAL = { id: 'prenatal', color: '#f59e0b' }; // amber,  hue ~38

describe('hueOf', () => {
  it('reads the hue angle from a hex colour', () => {
    expect(Math.round(hueOf('#f59e0b'))).toBe(38);
    expect(Math.round(hueOf('#6366f1'))).toBe(239);
    expect(Math.round(hueOf('#0ea5e9'))).toBe(199);
  });

  it('tolerates a missing hash and mixed case', () => {
    expect(Math.round(hueOf('F59E0B'))).toBe(38);
  });

  it('returns -1 for greys, which have no hue to match on', () => {
    expect(hueOf('#808080')).toBe(-1);
    expect(hueOf('#ffffff')).toBe(-1);
  });

  it('returns -1 for malformed input rather than throwing', () => {
    expect(hueOf('')).toBe(-1);
    expect(hueOf('not a colour')).toBe(-1);
    expect(hueOf('#12345')).toBe(-1);
  });
});

describe('assignClassTones — the stored colour picks the slot', () => {
  it('matches a class type to its nearest hue', () => {
    const tones = assignClassTones([PRENATAL]);
    expect(toneFor(tones, 'prenatal').key).toBe('amber');
  });

  it('gives indigo the blue slot', () => {
    const tones = assignClassTones([VINYASA]);
    expect(toneFor(tones, 'vinyasa').key).toBe('blue');
  });
});

describe('assignClassTones — collisions must not produce duplicates', () => {
  /**
   * THE CASE THIS EXISTS FOR. Vinyasa (#6366f1) and Reformer (#0ea5e9) are both
   * blues and both want the same slot. Using the stored hex directly would make
   * them near-identical on the grid, which is the whole failure colour-coding
   * is supposed to prevent.
   */
  it('gives two similar blues two DIFFERENT tones', () => {
    const tones = assignClassTones([VINYASA, REFORMER]);
    const a = toneFor(tones, 'vinyasa').key;
    const b = toneFor(tones, 'reformer').key;

    expect(a).toBe('blue'); // first in wins its preference
    expect(b).not.toBe(a); // second falls through
  });

  it('never repeats a tone across the studio', () => {
    const tones = assignClassTones([VINYASA, REFORMER, PRENATAL]);
    const keys = [...tones.values()].map((tone) => tone.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('assignClassTones — stability', () => {
  /**
   * The same input must always produce the same output. If this drifts, a class
   * type changes colour between page loads.
   */
  it('is deterministic across repeated calls', () => {
    const first = assignClassTones([VINYASA, REFORMER, PRENATAL]);
    const second = assignClassTones([VINYASA, REFORMER, PRENATAL]);
    for (const [id, tone] of first) {
      expect(second.get(id)?.key).toBe(tone.key);
    }
  });

  /**
   * Callers sort by created_at, so a NEW class type is appended. An existing
   * type must keep the colour its students already recognise.
   */
  it('does not repaint existing types when a new one is added', () => {
    const before = assignClassTones([VINYASA, REFORMER]);
    const after = assignClassTones([VINYASA, REFORMER, PRENATAL]);

    expect(after.get('vinyasa')?.key).toBe(before.get('vinyasa')?.key);
    expect(after.get('reformer')?.key).toBe(before.get('reformer')?.key);
  });
});

describe('assignClassTones — running out of slots', () => {
  it('falls back to neutral rather than inventing a sixth hue', () => {
    const many = Array.from({ length: CLASS_TONES.length + 2 }, (_, i) => ({
      id: `type-${i}`,
      color: '#6366f1',
    }));
    const tones = assignClassTones(many);

    const assigned = [...tones.values()];
    const coloured = assigned.filter((tone) => tone.key !== 'neutral');
    const neutral = assigned.filter((tone) => tone.key === 'neutral');

    expect(coloured).toHaveLength(CLASS_TONES.length);
    expect(neutral).toHaveLength(2);
  });

  it('handles a greyscale stored colour without matching arbitrarily', () => {
    const tones = assignClassTones([{ id: 'grey', color: '#888888' }]);
    expect(toneFor(tones, 'grey').key).toBe(CLASS_TONES[0].key);
  });
});

describe('toneFor — never crashes a render', () => {
  it('returns the neutral tone for an unknown id', () => {
    const tones = assignClassTones([VINYASA]);
    expect(toneFor(tones, 'no-such-type')).toBe(NEUTRAL_TONE);
    expect(toneFor(tones, null)).toBe(NEUTRAL_TONE);
    expect(toneFor(tones, undefined)).toBe(NEUTRAL_TONE);
  });
});
