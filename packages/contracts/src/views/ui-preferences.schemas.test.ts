import { describe, expect, it } from 'vitest';

import {
  CARD_TABS_MAX_BYTES,
  cardTabsPrefSchema,
  uiPreferencesSchema,
  updateUserPreferencesBodySchema,
} from './ui-preferences.schemas.js';

function pref(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    groups: [{ tabs: ['structure', 'tasks'] }, { tabs: ['channel', 'files'], active: 'channel' }],
    ...overrides,
  };
}

describe('cardTabsPrefSchema', () => {
  it('принимает 1–2 непустые области и активную вкладку своей области', () => {
    expect(cardTabsPrefSchema.safeParse(pref()).success).toBe(true);
    expect(
      cardTabsPrefSchema.safeParse({
        version: 1,
        groups: [{ tabs: ['chat'], active: 'chat' }],
        widths: { data: 430, groups: [600] },
        hidden: ['history'],
        panelOpen: true,
      }).success,
    ).toBe(true);
  });

  it('отклоняет дубль вкладки между областями и активную не из своей области', () => {
    expect(
      cardTabsPrefSchema.safeParse({
        version: 1,
        groups: [{ tabs: ['structure'] }, { tabs: ['structure'] }],
      }).success,
    ).toBe(false);
    expect(
      cardTabsPrefSchema.safeParse({
        version: 1,
        groups: [{ tabs: ['structure'], active: 'tasks' }],
      }).success,
    ).toBe(false);
  });

  it('отклоняет пустую область, третью область и неизвестную версию', () => {
    expect(cardTabsPrefSchema.safeParse({ version: 1, groups: [{ tabs: [] }] }).success).toBe(
      false,
    );
    expect(
      cardTabsPrefSchema.safeParse({
        version: 1,
        groups: [{ tabs: ['structure'] }, { tabs: ['tasks'] }, { tabs: ['channel'] }],
      }).success,
    ).toBe(false);
    expect(
      cardTabsPrefSchema.safeParse({ version: 2, groups: [{ tabs: ['structure'] }] }).success,
    ).toBe(false);
  });

  it('не принимает файловые id как отдельные вкладки (только files)', () => {
    expect(
      cardTabsPrefSchema.safeParse({ version: 1, groups: [{ tabs: ['file:123'] }] }).success,
    ).toBe(false);
    expect(
      cardTabsPrefSchema.safeParse({
        version: 1,
        groups: [{ tabs: ['files'] }],
        hidden: ['file:123'],
      }).success,
    ).toBe(false);
  });

  it('отбрасывает неизвестные поля (strip), не ломая старые клиенты', () => {
    const parsed = cardTabsPrefSchema.parse({ ...pref(), legacy: true } as never);
    expect('legacy' in parsed).toBe(false);
  });
});

describe('uiPreferencesSchema', () => {
  it('старые настройки без cardTabs остаются валидными', () => {
    expect(uiPreferencesSchema.safeParse({ navOrder: ['home'], navHidden: [] }).success).toBe(true);
    expect(uiPreferencesSchema.safeParse({}).success).toBe(true);
  });

  it('принимает cardTabs для трёх видов карточек и отбрасывает мусор', () => {
    const parsed = uiPreferencesSchema.parse({
      cardTabs: {
        project: pref(),
        task: { version: 1, groups: [{ tabs: ['chat', 'files'] }] },
        letter: { version: 1, groups: [{ tabs: ['body', 'chat', 'history'] }] },
      },
    });
    expect(parsed.cardTabs?.project?.groups).toHaveLength(2);
    expect(parsed.cardTabs?.task?.groups[0]?.tabs).toEqual(['chat', 'files']);
  });

  it('битая раскладка отбрасывается, остальные настройки выживают', () => {
    const parsed = uiPreferencesSchema.parse({
      navOrder: ['home'],
      cardTabs: {
        project: { version: 1, groups: [] },
        task: { version: 1, groups: [{ tabs: ['chat'] }] },
      },
    });
    // z.object по умолчанию strip не удаляет невалидный ключ — safeParse
    // уровня uiPreferences должен отклонить битый вложенный объект.
    expect(parsed.cardTabs?.project).toBeUndefined();
  });
});

describe('updateUserPreferencesBodySchema', () => {
  it('ограничивает размер предпочтений 32 КБ', () => {
    const huge = {
      navOrder: Array.from({ length: 4000 }, (_, i) => `module-${i}-${'x'.repeat(10)}`),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(huge)).length;
    expect(bytes).toBeGreaterThan(CARD_TABS_MAX_BYTES);
    expect(updateUserPreferencesBodySchema.safeParse({ preferences: huge }).success).toBe(false);
  });

  it('принимает обычное тело и опциональный baseUpdatedAt', () => {
    expect(
      updateUserPreferencesBodySchema.safeParse({
        preferences: { cardTabs: { project: pref() } },
        baseUpdatedAt: '2026-11-11T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('на записи невалидная раскладка — ошибка, а не тихая потеря', () => {
    expect(
      updateUserPreferencesBodySchema.safeParse({
        preferences: { cardTabs: { project: { version: 1, groups: [] } } },
      }).success,
    ).toBe(false);
  });
});
