import { describe, expect, it } from 'vitest';

import { desktopConfigSchema } from './desktop-config.schema.js';

/** Контракт оболочки (#843): minShellVersion — ровно major.minor.patch,
 *  хвост «.4» не проходил и ломал сравнение версий на клиенте. */
describe('desktopConfigSchema: minShellVersion', () => {
  const parse = (minShellVersion: string) =>
    desktopConfigSchema.safeParse({ serverName: 'Nodus', minShellVersion });

  it('принимает major.minor.patch', () => {
    expect(parse('0.0.0').success).toBe(true);
    expect(parse('1.20.3').success).toBe(true);
  });

  it('отклоняет лишние сегменты и префиксы', () => {
    expect(parse('1.2.3.4').success).toBe(false);
    expect(parse('v1.2.3').success).toBe(false);
    expect(parse('1.2').success).toBe(false);
    expect(parse('1.2.3-beta').success).toBe(false);
  });
});
