import { describe, expect, it } from 'vitest';
import type { ProcessType, ProcessTypeConfig } from '@nodus/contracts';

import {
  accessSummary,
  blocksSummary,
  numberingSummary,
  roleLabelsSummary,
} from './type-settings-summary.js';

const HEAD = '11111111-1111-4111-8111-111111111111';
const HR = '22222222-2222-4222-8222-222222222222';

const type = (
  over: Partial<ProcessType> = {},
  config?: Partial<ProcessTypeConfig>,
): ProcessType => ({
  id: 'overtime',
  code: 'overtime',
  name: 'Переработка',
  category: 'task',
  direction: null,
  icon: 'calendar-clock',
  color: 'warning',
  description: '',
  creatable: true,
  isSystem: false,
  sortOrder: 2,
  archivedAt: null,
  workflowId: 'wf-overtime',
  config: {
    card: { hiddenBlocks: [], roleLabels: {} },
    access: { view: null, create: null },
    creation: { excludedProjectTypeIds: [], folderKindId: null, withoutProject: true },
    ...config,
  },
  creationForm: { fields: [], chips: [] },
  viewer: { canView: true, canCreate: true },
  numbering: null,
  ...over,
});

const names: Record<string, string> = { [HEAD]: 'Руководство', [HR]: 'Кадры' };
const roleName = (id: string) => names[id];

describe('сводки «Настроек типа» (#432)', () => {
  it('доступ: всем — «Видят все · создают все»', () => {
    expect(accessSummary(type(), roleName)).toBe('Видят все · создают все');
  });

  it('доступ: роли по именам, «никто» для пустого списка', () => {
    const restricted = type({}, { access: { view: [HEAD, HR], create: [] } });
    expect(accessSummary(restricted, roleName)).toBe('Видят: Руководство, Кадры · создают: никто');
  });

  it('доступ: creatable=false — «создаёт только администратор»; «Стандартный» — всем', () => {
    expect(accessSummary(type({ creatable: false }), roleName)).toBe(
      'Видят все · создаёт только администратор',
    );
    expect(accessSummary(type({ code: 'task' }), roleName)).toBe(
      'Всем — по нему создают быстрые входы',
    );
  });

  it('доступ: роли ещё грузятся — многоточие вместо имён', () => {
    const restricted = type({}, { access: { view: [HEAD], create: null } });
    expect(accessSummary(restricted, () => undefined)).toBe('Видят: … · создают все');
  });

  it('блоки: в порядке карточки, строчными', () => {
    expect(blocksSummary(type())).toBe('Все блоки видны');
    const hidden = type({}, { card: { hiddenBlocks: ['time', 'checklist'], roleLabels: {} } });
    expect(blocksSummary(hidden)).toBe('Скрыты: чек-лист, время');
  });

  it('роли: стандартные или «было → стало»', () => {
    expect(roleLabelsSummary(type())).toBe('Стандартные');
    const renamed = type(
      {},
      {
        card: { hiddenBlocks: [], roleLabels: { creator: 'Заявитель', observer: 'Кадры' } },
      },
    );
    expect(roleLabelsSummary(renamed)).toBe('Постановщик → Заявитель, Наблюдатель → Кадры');
  });
});

describe('нумерация типа (#55, Р2)', () => {
  it('серия письма — «Вх-ГГГГ/N», у задачи нумерации нет', () => {
    expect(numberingSummary(type())).toBe('Без нумерации');
    expect(
      numberingSummary(
        type({
          category: 'letter',
          numbering: {
            seriesId: '00000000-0000-4000-8000-0000000000aa',
            prefix: 'Вх',
            reset: 'year',
          },
        }),
      ),
    ).toBe('Вх-ГГГГ/N');
  });
});
