import { describe, expect, it } from 'vitest';

import { compareVersions } from './compare-versions.js';

describe('compareVersions (#1038)', () => {
  it('равные версии → 0', () => {
    expect(compareVersions('0.16.0', '0.16.0')).toBe(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('0.0.0', '0.0.0')).toBe(0);
  });

  it('больше/меньше по каждой позиции semver', () => {
    expect(compareVersions('0.16.0', '0.15.9')).toBe(1);
    expect(compareVersions('0.15.9', '0.16.0')).toBe(-1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('0.2.1', '0.2.0')).toBe(1);
  });

  it('сравнение числовое, не строковое: 0.10.0 > 0.9.0', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.9.0', '0.10.0')).toBe(-1);
  });

  it('кривые входы: нечисловые и отсутствующие части = 0, хвост игнорируется', () => {
    expect(compareVersions('0.16', '0.16.0')).toBe(0);
    expect(compareVersions('', '0.0.0')).toBe(0);
    expect(compareVersions('мусор', '0.0.0')).toBe(0);
    expect(compareVersions('0.16.x', '0.16.0')).toBe(0);
    expect(compareVersions('0.16.0.99', '0.16.0')).toBe(0);
    expect(compareVersions('0.16.0-beta', '0.16.0')).toBe(0);
    expect(compareVersions('1.мусор.2', '1.0.2')).toBe(0);
  });
});
