import { z } from 'zod';

import {
  Permission,
  createCounterpartyBodySchema,
  updateCounterpartyBodySchema,
  type CounterpartyCard,
} from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { asTyped } from '../projections.js';
import { counterpartyName, field, fieldsOf, shortId } from './write-cards.js';
import { counterpartiesMeta } from './meta/counterparties.meta.js';

/**
 * Запись справочника контрагентов (#932): создание и правка реквизитов.
 * Только через карточку подтверждения (ADR-0048); архив, удаление и
 * массовые операции — не для ассистента (решение владельца).
 */

const CREATE_LABEL: readonly (readonly [string, string])[] = [
  ['shortName', 'Краткое название'],
  ['fullName', 'Полное название'],
  ['unp', 'УНП'],
  ['address', 'Адрес'],
  ['email', 'Почта'],
  ['phone', 'Телефон'],
];

const PATCH_LABEL: Record<string, string> = {
  fullName: 'Полное название',
  shortName: 'Краткое название',
  unp: 'УНП',
  address: 'Адрес',
  email: 'Почта',
  phone: 'Телефон',
};

function cardValue(value: unknown): string | null {
  if (value === null) return 'очистить';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function counterpartyText(data: unknown, fallback: string): string {
  const card = asTyped<CounterpartyCard>(data);
  if (!card?.id) return fallback;
  return `${fallback}: ${card.shortName}${card.unp ? ` (УНП ${card.unp})` : ''}`;
}

function counterpartyEntity(data: unknown): { href: string; label: string } | undefined {
  const card = asTyped<CounterpartyCard>(data);
  if (!card?.id) return undefined;
  return { href: `?cards=counterparty:${card.id}`, label: card.shortName };
}

export const counterpartiesCreateTool = defineTool({
  ...counterpartiesMeta['counterparties.create'],
  id: 'counterparties.create',
  title: 'Контрагенты: создать',
  description:
    'Создать контрагента в общем справочнике: названия обязательны, УНП, адрес, почта и телефон — по желанию. Действие появится карточкой подтверждения.',
  keywords: [
    'создать контрагента',
    'завести организацию',
    'добавить подрядчика',
    'новый поставщик',
    'create counterparty',
  ],
  module: 'crm',
  kind: 'write',
  permission: Permission.CRM_CREATE,
  featureFlag: 'crm',
  hot: false,
  input: createCounterpartyBodySchema,
  api: { method: 'POST', path: '/counterparties' },
  build: (input) => ({ method: 'POST', path: '/counterparties', body: input }),
  project: (data) => ({
    text: counterpartyText(data, 'Контрагент создан'),
    entity: counterpartyEntity(data),
  }),
  card: {
    title: 'Создать контрагента',
    summary: (input) =>
      `Новый контрагент «${input.shortName}»${input.unp ? ` (УНП ${input.unp})` : ''}`,
    fields: (input) =>
      fieldsOf(
        CREATE_LABEL.map(([key, label]) =>
          field(label, cardValue((input as Record<string, unknown>)[key])),
        ),
      ),
    consequences:
      'Контрагент появится в общем справочнике и станет доступен в письмах и проектах. Автоматической отмены нет: архив и удаление — только в интерфейсе.',
  },
});

export const counterpartiesUpdateTool = defineTool({
  ...counterpartiesMeta['counterparties.update'],
  id: 'counterparties.update',
  title: 'Контрагенты: изменить реквизиты',
  description:
    'Исправить реквизиты контрагента: названия, УНП, адрес, почту, телефон. Передаются только изменяемые поля; действие появится карточкой подтверждения.',
  keywords: [
    'изменить контрагента',
    'поправить реквизиты',
    'исправить УНП',
    'поменять телефон организации',
    'update counterparty',
  ],
  module: 'crm',
  kind: 'write',
  permission: Permission.CRM_MANAGE,
  featureFlag: 'crm',
  hot: false,
  input: z.object({ counterpartyId: z.uuid(), patch: updateCounterpartyBodySchema }),
  api: { method: 'PATCH', path: '/counterparties/:id' },
  build: (input) => ({
    method: 'PATCH',
    path: `/counterparties/${input.counterpartyId}`,
    body: input.patch,
  }),
  project: (data) => ({
    text: counterpartyText(data, 'Реквизиты контрагента обновлены'),
    entity: counterpartyEntity(data),
  }),
  card: {
    title: 'Изменить реквизиты контрагента',
    summary: async (input, ctx) =>
      `${(await counterpartyName(ctx, input.counterpartyId)) ?? shortId(input.counterpartyId)}: ${Object.keys(
        input.patch,
      )
        .map((key) => PATCH_LABEL[key] ?? key)
        .join(', ')}`,
    fields: async (input, ctx) => {
      const rows = [
        field('Контрагент', await counterpartyName(ctx, input.counterpartyId)),
        ...Object.entries(input.patch).map(([key, value]) =>
          field(`Новое: ${PATCH_LABEL[key] ?? key}`, cardValue(value)),
        ),
      ];
      return fieldsOf(rows);
    },
    consequences:
      'Реквизиты контрагента обновятся во всех местах, где он используется. Автоматической отмены нет — прежние значения придётся вернуть вручную.',
  },
});

export const counterpartiesWriteTools = [counterpartiesCreateTool, counterpartiesUpdateTool];
