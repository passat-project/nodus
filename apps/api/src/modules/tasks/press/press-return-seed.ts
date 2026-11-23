import { ui } from '@nodus/contracts';

/** Строка прошлого цикла, из которой строится состав нового раунда (В2, 16.11). */
export interface PressSeedSource {
  userId: string;
  order: number;
  state: string;
  pressedAt?: Date | null;
  input?: unknown;
  result?: unknown;
  timeEntryId?: string | null;
  returnReason?: string | null;
}

/** Состав нового раунда — поля совпадают с `createRound().entries[]`. */
export type PressSeedEntry = PressSeedSource;

/**
 * Возврат в тот же статус после полного сбора (В2, 16.11): выбранные снова
 * видят кнопку и сдают заново, остальные сохраняют отметки прошлого цикла.
 * Вынесено из `PressRoundsService.ensureForStage` — чистый маппинг снимка
 * прошлого раунда без обращений к БД (#965).
 */
export function seedReturnEntries(
  previous: readonly PressSeedSource[],
  returnUserIds: readonly string[],
): PressSeedEntry[] {
  const selected = new Set(returnUserIds);
  return previous.map((entry) => {
    if (entry.state === 'excluded') {
      return {
        userId: entry.userId,
        order: entry.order,
        state: 'excluded',
        returnReason: entry.returnReason ?? ui.tasks.press.excludedReason,
      };
    }
    // Выбранный начинает заново; невыбранный сохраняет отметку только
    // если реально сдавал. Остальные снова ждут — иначе «сдал» без
    // нажатия закрыл бы кворум нового цикла (security-аудит #707).
    if (selected.has(entry.userId)) {
      return {
        userId: entry.userId,
        order: entry.order,
        state: 'returned',
        input: null,
        result: null,
        timeEntryId: null,
        returnReason: ui.tasks.press.returnedReason,
      };
    }
    if (entry.state === 'pressed') {
      return {
        userId: entry.userId,
        order: entry.order,
        state: 'pressed',
        pressedAt: entry.pressedAt,
        input: entry.input,
        result: entry.result,
        timeEntryId: entry.timeEntryId,
      };
    }
    // Невыбранный и не сдававший в прошлом цикле не должен снова
    // видеть кнопку: он вне нового состава (В2, «только выбранные»).
    return {
      userId: entry.userId,
      order: entry.order,
      state: 'excluded',
      returnReason: ui.tasks.press.excludedReason,
      input: null,
      result: null,
    };
  });
}
