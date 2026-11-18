import { describe, expect, it, vi } from 'vitest';

import { Permission } from '@nodus/contracts';

import { buildCatalog } from '../catalog.js';
import type { ToolContext } from '../tool-definition.js';
import { counterpartiesGetTool, counterpartiesListTool } from './counterparties.tools.js';
import {
  counterpartiesCreateTool,
  counterpartiesUpdateTool,
} from './counterparties-write.tools.js';

/** #932: контрагенты — реестр, карточка, создание и правка (карточки, права). */

const P = '11111111-1111-4111-8111-111111111111';

const ctx: ToolContext = {
  authorization: 'Bearer t',
  screen: { moduleId: null, cardKind: null, cardId: null },
  signal: new AbortController().signal,
  available: [],
  activate: () => undefined,
  read: vi.fn(async (path: string) => {
    if (path === `/counterparties/${P}`)
      return { id: P, shortName: 'Стройпроект', fullName: 'ООО «Стройпроект»' };
    return null;
  }),
};

describe('реестр контрагентов', () => {
  it('поиск и архив уходят в query, проекция считает связи', () => {
    expect(
      counterpartiesListTool.build!({ search: 'Строй', includeArchived: true, limit: 20 }),
    ).toEqual({
      path: '/counterparties',
      query: { limit: '20', includeArchived: 'true', search: 'Строй' },
    });
    const result = counterpartiesListTool.project!(
      {
        items: [
          {
            id: P,
            fullName: 'ООО «Стройпроект»',
            shortName: 'Стройпроект',
            unp: '190123456',
            address: null,
            email: null,
            phone: null,
            lettersCount: 12,
            projectsCount: 3,
            contactsCount: 2,
            archivedAt: null,
          },
        ],
        nextCursor: null,
      },
      {},
    );
    expect(result.text).toContain('Стройпроект');
    expect(result.text).toContain('УНП 190123456');
    expect(result.text).toContain('писем 12');
  });
});

describe('карточка контрагента', () => {
  it('показывает реквизиты, связи и контактных лиц со ссылкой', () => {
    expect(counterpartiesGetTool.build!({ counterpartyId: P })).toEqual({
      path: `/counterparties/${P}`,
    });
    const result = counterpartiesGetTool.project!(
      {
        id: P,
        fullName: 'ООО «Стройпроект»',
        shortName: 'Стройпроект',
        unp: '190123456',
        address: 'г. Минск, ул. Строителей, 1',
        email: 'office@example.by',
        phone: '+375 17 000-00-00',
        customFields: {},
        lettersCount: 12,
        projectsCount: 3,
        contactPersons: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            fullName: 'Иванов Иван',
            position: 'Директор',
            phone: null,
            email: null,
            archivedAt: null,
          },
        ],
        archivedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {},
    );
    expect(result.text).toContain('УНП: 190123456');
    expect(result.text).toContain('писем 12, проектов 3');
    expect(result.text).toContain('Иванов Иван — Директор');
    expect(result.entity?.href).toBe(`?cards=counterparty:${P}`);
  });
});

describe('создание контрагента', () => {
  it('тело уходит как есть, карточка называет организацию', async () => {
    const input = {
      fullName: 'Общество с ограниченной ответственностью «Мостоотряд 5»',
      shortName: 'Мостоотряд 5',
      unp: '190123456',
    };
    expect(counterpartiesCreateTool.build!(input)).toEqual({
      method: 'POST',
      path: '/counterparties',
      body: input,
    });
    expect(await counterpartiesCreateTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([
        { label: 'Краткое название', value: 'Мостоотряд 5' },
        { label: 'УНП', value: '190123456' },
      ]),
    );
    expect(counterpartiesCreateTool.card!.undo).toBeUndefined();
  });

  it('без права crm.create и без флага crm инструмента нет', () => {
    expect(counterpartiesCreateTool.permission).toBe(Permission.CRM_CREATE);
    const without = buildCatalog({ permissions: ['assistant.use'], features: ['crm'] });
    expect(without.some((tool) => tool.id === 'counterparties.create')).toBe(false);
    const withRight = buildCatalog({
      permissions: ['assistant.use', Permission.CRM_CREATE],
      features: ['crm'],
    });
    expect(withRight.some((tool) => tool.id === 'counterparties.create')).toBe(true);
    const withoutFlag = buildCatalog({
      permissions: ['assistant.use', Permission.CRM_CREATE],
      features: [],
    });
    expect(withoutFlag.some((tool) => tool.id === 'counterparties.create')).toBe(false);
  });
});

describe('правка контрагента', () => {
  it('патч уходит в тело, карточка называет текущее имя и новые значения', async () => {
    const input = { counterpartyId: P, patch: { phone: '+375 17 111-11-11' } };
    expect(counterpartiesUpdateTool.build!(input)).toEqual({
      method: 'PATCH',
      path: `/counterparties/${P}`,
      body: { phone: '+375 17 111-11-11' },
    });
    expect(await counterpartiesUpdateTool.card!.fields(input, ctx)).toEqual(
      expect.arrayContaining([
        { label: 'Контрагент', value: 'Стройпроект' },
        { label: 'Новое: Телефон', value: '+375 17 111-11-11' },
      ]),
    );
  });

  it('пустой патч отклоняется схемой, право — crm.manage', () => {
    expect(counterpartiesUpdateTool.input.safeParse({ counterpartyId: P, patch: {} }).success).toBe(
      false,
    );
    expect(counterpartiesUpdateTool.permission).toBe(Permission.CRM_MANAGE);
    const without = buildCatalog({
      permissions: ['assistant.use', Permission.CRM_CREATE],
      features: ['crm'],
    });
    expect(without.some((tool) => tool.id === 'counterparties.update')).toBe(false);
  });
});
