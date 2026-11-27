import type { ProcessTypeIcon } from '@nodus/contracts';
import { processTypeIconSchema, ui } from '@nodus/contracts';

import { ProcessTypeGlyph } from './process-type-icon.js';

/** Варианты значка типа для сетки и поповера выбора: ключ набора
 *  `processTypeIconSchema`, русское имя — для подписи и скринридера. */
export const PROCESS_TYPE_ICON_OPTIONS = processTypeIconSchema.options.map((icon) => ({
  value: icon as ProcessTypeIcon,
  label: ui.automation.entry.iconNames[icon],
  glyph: <ProcessTypeGlyph icon={icon} className="size-4" />,
}));
