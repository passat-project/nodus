import { describe, expect, it } from 'vitest';
import { stageColorSchema } from '@nodus/contracts';

import { stageColorOrder, stageTone } from './stage-tone.js';

describe('stageTone (#403)', () => {
  it('каждый цвет схемы имеет тон и место в палитре', () => {
    expect(new Set(stageColorOrder)).toEqual(new Set(stageColorSchema.options));
    for (const color of stageColorSchema.options) {
      expect(stageTone[color].chip.length).toBeGreaterThan(0);
      expect(stageTone[color].swatch.length).toBeGreaterThan(0);
    }
  });

  it('палитра расширена до 10 различимых тонов', () => {
    expect(stageColorOrder.length).toBeGreaterThanOrEqual(10);
  });
});
