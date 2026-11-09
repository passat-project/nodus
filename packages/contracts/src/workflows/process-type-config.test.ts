import { describe, expect, it } from 'vitest';

import { creationSlots } from './creation-form.js';
import {
  DEFAULT_PROCESS_TYPE_CONFIG,
  DEFAULT_TASK_CARD_LAYOUT,
  isDefaultProcessType,
  normalizeTypeConfig,
  taskLayoutOf,
  typeAccessFor,
  typeConfigOf,
  typeCreationFormOf,
  bindingsOf,
  typeViewerOf,
  updateProcessTypeConfigBodySchema,
} from './process-type-config.js';

/** Конфигурация типа процесса (#432): толерантное чтение, доступ по ролям,
 *  блокировка «Стандартного» и закрытая схема правки. */

const roleA = '11111111-1111-4111-8111-111111111111';
const roleB = '22222222-2222-4222-8222-222222222222';

describe('normalizeTypeConfig', () => {
  it('пустой объект — умолчания', () => {
    expect(normalizeTypeConfig({})).toEqual(DEFAULT_PROCESS_TYPE_CONFIG);
    expect(normalizeTypeConfig(null)).toEqual(DEFAULT_PROCESS_TYPE_CONFIG);
  });

  it('битый раздел заменяется умолчанием, целые разделы живут', () => {
    const config = normalizeTypeConfig({
      card: { hiddenBlocks: ['chat', 'нет-такого'], roleLabels: { assignee: 'Заявитель' } },
      access: { view: [roleA], create: null },
    });
    expect(config.card).toEqual(DEFAULT_PROCESS_TYPE_CONFIG.card);
    expect(config.access).toEqual({ view: [roleA], create: null });
  });

  it('валидные разделы читаются целиком', () => {
    const config = normalizeTypeConfig({
      card: { hiddenBlocks: ['checklist', 'subtasks'], roleLabels: { assignee: 'Заявитель' } },
      access: { view: [roleA], create: [roleB] },
    });
    expect(config.card.hiddenBlocks).toEqual(['checklist', 'subtasks']);
    expect(config.card.roleLabels.assignee).toBe('Заявитель');
    expect(config.access).toEqual({ view: [roleA], create: [roleB] });
  });

  it('снятые ключи (флаг пульса до 26.10) отбрасываются — схема закрыта', () => {
    const config = normalizeTypeConfig({ pulse: true, access: { view: null, create: null } });
    expect(config).toEqual(DEFAULT_PROCESS_TYPE_CONFIG);
    expect('pulse' in config).toBe(false);
  });

  it('нумерация письма (#55): валидная серия читается, битая — тип без серии', () => {
    const seriesId = '33333333-3333-4333-8333-333333333333';
    expect(normalizeTypeConfig({ numbering: { seriesId } }).numbering).toEqual({ seriesId });
    const broken = normalizeTypeConfig({ numbering: { seriesId: 'Вх' } });
    expect('numbering' in broken).toBe(false);
    expect(broken.card).toEqual(DEFAULT_PROCESS_TYPE_CONFIG.card);
    expect('numbering' in normalizeTypeConfig({})).toBe(false);
  });
});

describe('typeAccessFor', () => {
  const type = (over: Partial<Parameters<typeof typeAccessFor>[0]> = {}) => ({
    config: DEFAULT_PROCESS_TYPE_CONFIG,
    creatable: true,
    ...over,
  });

  it('администратор видит и создаёт всё, даже скрытый тип', () => {
    expect(
      typeAccessFor(
        type({
          creatable: false,
          config: { ...DEFAULT_PROCESS_TYPE_CONFIG, access: { view: [roleA], create: [roleA] } },
        }),
        { roleIds: [], isAdmin: true },
      ),
    ).toEqual({ canView: true, canCreate: true });
  });

  it('«всем» и создание разрешено — обычный сотрудник создаёт', () => {
    expect(typeAccessFor(type(), { roleIds: [], isAdmin: false })).toEqual({
      canView: true,
      canCreate: true,
    });
  });

  it('роль в списке «видят», но не в «создают» — видит, не создаёт', () => {
    const restricted = type({
      config: { ...DEFAULT_PROCESS_TYPE_CONFIG, access: { view: [roleA], create: [roleB] } },
    });
    expect(typeAccessFor(restricted, { roleIds: [roleA], isAdmin: false })).toEqual({
      canView: true,
      canCreate: false,
    });
  });

  it('без общей роли типа не видно вовсе', () => {
    const restricted = type({
      config: { ...DEFAULT_PROCESS_TYPE_CONFIG, access: { view: [roleA], create: null } },
    });
    expect(typeAccessFor(restricted, { roleIds: [roleB], isAdmin: false })).toEqual({
      canView: false,
      canCreate: false,
    });
  });

  it('creatable=false — создают только администраторы (Р6)', () => {
    expect(typeAccessFor(type({ creatable: false }), { roleIds: [roleA], isAdmin: false })).toEqual(
      { canView: true, canCreate: false },
    );
  });

  it('«Стандартный» опознаётся по коду', () => {
    expect(isDefaultProcessType({ code: 'task' })).toBe(true);
    expect(isDefaultProcessType({ code: 'overtime' })).toBe(false);
  });
});

describe('updateProcessTypeConfigBodySchema', () => {
  it('один раздел не добавляет соседние (gotcha Zod 4 .partial)', () => {
    const card = { hiddenBlocks: ['chat' as const], roleLabels: {} };
    const parsed = updateProcessTypeConfigBodySchema.parse({ card });
    expect(parsed).toEqual({ card });
    expect('access' in parsed).toBe(false);
  });

  it('неизвестный ключ отвергается (и снятый `pulse`), пустая правка — тоже', () => {
    expect(updateProcessTypeConfigBodySchema.safeParse({ pulse: true }).success).toBe(false);
    expect(
      updateProcessTypeConfigBodySchema.safeParse({
        access: { view: null, create: null },
        extra: 1,
      }).success,
    ).toBe(false);
    expect(updateProcessTypeConfigBodySchema.safeParse({}).success).toBe(false);
  });

  it('access: null — «всем», список ролей — ограничение', () => {
    expect(
      updateProcessTypeConfigBodySchema.parse({ access: { view: null, create: [roleA] } }),
    ).toEqual({ access: { view: null, create: [roleA] } });
  });
});

describe('терпимое чтение со старого API (:5173 без #432)', () => {
  it('нет config — умолчания; нет viewer — права по creatable', () => {
    expect(typeConfigOf({})).toEqual(DEFAULT_PROCESS_TYPE_CONFIG);
    expect(typeViewerOf({ creatable: false })).toEqual({ canView: true, canCreate: false });
    expect(typeViewerOf({ creatable: true })).toEqual({ canView: true, canCreate: true });
  });

  it('нет creationForm — форма по умолчанию категории', () => {
    expect(creationSlots(typeCreationFormOf({ category: 'task' })).map((slot) => slot.key)).toEqual(
      ['description', 'assignee', 'deadline', 'project'],
    );
  });

  it('нет bindings — пустые привязки (атрибут нигде не показывается)', () => {
    expect(bindingsOf({})).toEqual({ processTypeIds: [], projectTypeIds: [], nodeKindIds: [] });
    expect(
      bindingsOf({ bindings: { processTypeIds: [roleA], projectTypeIds: [], nodeKindIds: [] } }),
    ).toEqual({ processTypeIds: [roleA], projectTypeIds: [], nodeKindIds: [] });
  });

  it('нет layout — полная карточка', () => {
    expect(taskLayoutOf({})).toEqual(DEFAULT_TASK_CARD_LAYOUT);
    expect(taskLayoutOf({ layout: { hiddenBlocks: ['chat'] } })).toEqual(DEFAULT_TASK_CARD_LAYOUT);
    expect(
      taskLayoutOf({
        layout: { hiddenBlocks: ['chat'], roleLabels: { assignee: 'Заявитель' }, requiredKeys: [] },
      }),
    ).toEqual({ hiddenBlocks: ['chat'], roleLabels: { assignee: 'Заявитель' }, requiredKeys: [] });
  });
});
