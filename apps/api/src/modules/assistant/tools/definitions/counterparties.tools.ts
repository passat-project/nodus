import { z } from 'zod';

import type { CounterpartyCard, CounterpartyListItem, Paginated } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { asTyped, finalize, hasMore, listBlock, pageItems } from '../projections.js';
import { counterpartiesMeta } from './meta/counterparties.meta.js';

/**
 * Чтение справочника контрагентов (#932): реестр с поиском и карточка с
 * реквизитами, контактными лицами и счётчиками связей. Справочник общий —
 * чтение доступно всем сотрудникам, ограничения проверяет API (I8).
 */

const listInput = z.object({
  search: z.string().trim().min(1).max(128).optional(),
  includeArchived: z.boolean().default(false),
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(50).default(30),
});

export const counterpartiesListTool = defineTool({
  ...counterpartiesMeta['counterparties.list'],
  id: 'counterparties.list',
  title: 'Контрагенты: реестр',
  description:
    'Реестр контрагентов с поиском по названию и УНП: краткое название, счётчики писем/проектов/контактов, архивность. Курсор — из предыдущего ответа.',
  keywords: [
    'контрагенты',
    'организации',
    'подрядчики',
    'поставщики',
    'заказчики',
    'УНП',
    'реестр организаций',
    'counterparties',
  ],
  module: 'crm',
  kind: 'read',
  featureFlag: 'crm',
  hot: false,
  input: listInput,
  api: { method: 'GET', path: '/counterparties' },
  build: (input) => ({
    path: '/counterparties',
    query: {
      limit: String(input.limit),
      includeArchived: String(input.includeArchived),
      ...(input.search ? { search: input.search } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    },
  }),
  project: (data: Paginated<CounterpartyListItem>) => {
    const rows = pageItems<CounterpartyListItem>(data).map((raw) => {
      const item = asTyped<CounterpartyListItem>(raw);
      if (!item) return null;
      const counters = `писем ${item.lettersCount}, проектов ${item.projectsCount}, контактов ${item.contactsCount}`;
      const archived = item.archivedAt ? ' — архивный' : '';
      return `${item.shortName}${item.unp ? ` · УНП ${item.unp}` : ''} · ${counters}${archived}`;
    });
    return {
      text: finalize(
        listBlock(
          'Контрагенты',
          rows.filter((row): row is string => row !== null),
          { maxRows: 40, more: hasMore(data) },
        ),
      ),
    };
  },
});

export const counterpartiesGetTool = defineTool({
  ...counterpartiesMeta['counterparties.get'],
  id: 'counterparties.get',
  title: 'Контрагенты: карточка',
  description:
    'Карточка контрагента: полное и краткое названия, УНП, адрес, почта, телефон, счётчики связей и контактные лица (действующие и архивные).',
  keywords: [
    'карточка контрагента',
    'реквизиты организации',
    'контакты подрядчика',
    'контактные лица',
    'УНП',
    'counterparty card',
  ],
  module: 'crm',
  kind: 'read',
  featureFlag: 'crm',
  hot: false,
  input: z.object({ counterpartyId: z.uuid() }),
  api: { method: 'GET', path: '/counterparties/:id' },
  build: (input) => ({ path: `/counterparties/${input.counterpartyId}` }),
  project: (data) => {
    const card = asTyped<CounterpartyCard>(data);
    if (!card?.id) return { text: 'Карточка контрагента недоступна.' };
    const lines: string[] = [`Контрагент: ${card.shortName}`];
    if (card.fullName !== card.shortName) lines.push(`Полное название: ${card.fullName}`);
    if (card.unp) lines.push(`УНП: ${card.unp}`);
    if (card.address) lines.push(`Адрес: ${card.address}`);
    const contact = [
      card.email ? `почта ${card.email}` : null,
      card.phone ? `телефон ${card.phone}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    if (contact) lines.push(`Связь: ${contact}`);
    lines.push(
      `Связи: писем ${card.lettersCount}, проектов ${card.projectsCount}` +
        (card.archivedAt ? '; контрагент в архиве' : ''),
    );
    if (card.contactPersons.length > 0) {
      lines.push(`Контактные лица (${card.contactPersons.length}):`);
      for (const person of card.contactPersons) {
        const details = [
          person.position,
          person.phone ? `тел. ${person.phone}` : null,
          person.email,
          person.archivedAt ? 'архивный' : null,
        ]
          .filter(Boolean)
          .join(', ');
        lines.push(`- ${person.fullName}${details ? ` — ${details}` : ''}`);
      }
    }
    return {
      text: finalize(lines.join('\n')),
      entity: { href: `?cards=counterparty:${card.id}`, label: card.shortName },
    };
  },
});

export const counterpartiesReadTools = [counterpartiesListTool, counterpartiesGetTool];
