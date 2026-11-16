import { z } from 'zod';

import { defineTool } from '../tool-definition.js';
import {
  asArray,
  asRecord,
  date,
  dateTime,
  entityLink,
  finalize,
  hasMore,
  itemsOf,
  listBlock,
  nameOf,
  num,
  str,
} from '../projections.js';

/**
 * Инструменты корреспонденции (#892): реестр писем, карточка, кнопки маршрута,
 * связи-ответы и вложения — ТОЛЬКО МЕТАДАННЫЕ.
 *
 * Границы данных (ADR-0043 п. 8, ADR-0044 п. 5): содержимое вложений не
 * читается — ни `url`, ни `pdfUrl`, ни текст письма. `letters.attachments`
 * отдаёт имя, формат, размер, дату и признак конфиденциальности; это
 * закреплено тестом (attempt чтения файлов невозможен by design).
 */

const listInput = z.object({
  box: z.enum(['new', 'incoming', 'outgoing']).default('incoming'),
  search: z.string().trim().min(1).max(128).optional(),
  counterpartyId: z.uuid().optional(),
  limit: z.number().int().min(1).max(20).default(20),
});

function letterRow(raw: unknown): string | null {
  const letter = asRecord(raw);
  if (!letter) return null;
  const id = str(letter.id);
  if (!id) return null;
  const parts = [
    str(letter.regNumber) ? `№${str(letter.regNumber)}` : 'без номера',
    str(letter.subject) ? `«${str(letter.subject)}»` : '(без темы)',
    `направление ${letter.direction === 'outgoing' ? 'исходящее' : 'входящее'}`,
    `стадия «${str(asRecord(letter.stage)?.name) ?? '—'}»`,
  ];
  const counterparty = asRecord(letter.counterparty);
  if (counterparty) parts.push(`корреспондент «${nameOf(counterparty) ?? '—'}»`);
  if (str(letter.regDate)) parts.push(`дата ${date(letter.regDate)}`);
  if (str(letter.responseDeadline)) parts.push(`срок ответа ${date(letter.responseDeadline)}`);
  const attachments = num(letter.attachmentCount);
  if (attachments) parts.push(`вложений ${attachments}`);
  if (letter.confidential) parts.push('КОНФИДЕНЦИАЛЬНО');
  parts.push(`id ${id}`);
  return parts.join(', ');
}

export const lettersListTool = defineTool({
  id: 'letters.list',
  title: 'Письма: реестр',
  description:
    'Реестр писем: входящие, исходящие или новые (незарегистрированные), поиск по теме/номеру/корреспонденту. Отдаёт номер, тему, стадию, корреспондента, срок ответа и id.',
  keywords: [
    'письма',
    'письмо',
    'корреспонденция',
    'входящие',
    'исходящие',
    'реестр',
    'контрагент',
    'letters',
  ],
  module: 'letters',
  kind: 'read',
  featureFlag: 'correspondence',
  hot: true,
  input: listInput,
  api: { method: 'GET', path: '/letters' },
  build: (input) => ({
    path: '/letters',
    query: {
      box: input.box,
      limit: String(input.limit),
      ...(input.search ? { search: input.search } : {}),
      ...(input.counterpartyId ? { counterpartyId: input.counterpartyId } : {}),
    },
  }),
  project: (data) => {
    const rows = itemsOf(data)
      .map(letterRow)
      .filter((row): row is string => row !== null);
    const first = asRecord(itemsOf(data)[0]);
    return {
      text: finalize(listBlock('Письма', rows, { more: hasMore(data) })),
      ...(first && str(first.id)
        ? {
            entity: entityLink(
              'letter',
              str(first.id)!,
              str(first.regNumber) ?? str(first.subject) ?? 'Письмо',
            ),
          }
        : {}),
    };
  },
});

const getInput = z.object({ id: z.uuid() });

export const lettersGetTool = defineTool({
  id: 'letters.get',
  title: 'Письма: карточка',
  description:
    'Карточка письма по id: номер, тема, корреспондент, адресат, стадия, срок ответа, состав вложений (имена и форматы). Текст письма не читается — только метаданные.',
  keywords: ['письмо', 'карточка', 'тема', 'корреспондент', 'адресат', 'детали'],
  module: 'letters',
  kind: 'read',
  featureFlag: 'correspondence',
  hot: true,
  input: getInput,
  api: { method: 'GET', path: '/letters/:id' },
  build: (input) => ({ path: `/letters/${input.id}` }),
  project: (data) => {
    const letter = asRecord(data);
    const id = str(letter?.id);
    if (!letter || !id) return { text: 'Письмо не найдено или недоступно' };
    const attachments = asArray(letter.attachments);
    const lines = [
      `${str(letter.regNumber) ? `№${str(letter.regNumber)}` : 'Без номера'} «${str(letter.subject) ?? '(без темы)'}» (id ${id})`,
      `Направление: ${letter.direction === 'outgoing' ? 'исходящее' : 'входящее'}`,
      `Стадия: «${str(asRecord(letter.stage)?.name) ?? '—'}»`,
      `Корреспондент: ${nameOf(letter.counterparty) ?? '—'}`,
      `Адресат: ${nameOf(letter.addressee) ?? '—'}`,
      `Номер и дата корреспондента: ${str(letter.theirNumber) ?? '—'} от ${str(letter.theirDate) ? date(letter.theirDate) : '—'}`,
      `Дата регистрации: ${str(letter.regDate) ? date(letter.regDate) : 'не зарегистрировано'}`,
      `Срок ответа: ${str(letter.responseDeadline) ? date(letter.responseDeadline) : 'не задан'}`,
      letter.confidential ? 'Признак: КОНФИДЕНЦИАЛЬНО' : 'Признак: обычное',
      `Вложений: ${attachments.length} (содержимое не читается, только метаданные)`,
      ...attachments
        .slice(0, 10)
        .map((raw) => {
          const file = asRecord(raw);
          if (!file) return null;
          const size = num(file.size);
          return `— ${str(file.name) ?? 'файл'}, ${str(file.mime) ?? '—'}, ${size ? `${Math.round(size / 1024)} КБ` : 'размер неизвестен'}`;
        })
        .filter((line): line is string => line !== null),
    ];
    return {
      text: finalize(lines.join('\n')),
      entity: entityLink('letter', id, str(letter.regNumber) ?? str(letter.subject) ?? 'Письмо'),
    };
  },
});

const transitionsInput = z.object({ id: z.uuid() });

export const lettersTransitionsTool = defineTool({
  id: 'letters.transitions',
  title: 'Письма: маршрут',
  description:
    'Доступные кнопки маршрута письма по id: куда можно перевести, какие гейты не пройдены и кто может действовать. Полезно для «что дальше с письмом».',
  keywords: ['маршрут', 'переходы', 'кнопки', 'что дальше', 'резолюция', 'transitions'],
  module: 'letters',
  kind: 'read',
  featureFlag: 'correspondence',
  hot: false,
  input: transitionsInput,
  api: { method: 'GET', path: '/letters/:id/transitions' },
  build: (input) => ({ path: `/letters/${input.id}/transitions` }),
  project: (data) => {
    const rows = asArray(data).map((raw) => {
      const transition = asRecord(raw);
      if (!transition) return null;
      const blocked = asArray(transition.blockedBy).length;
      return `«${str(transition.name) ?? '—'}» → стадия «${str(transition.toStageName) ?? '—'}»${blocked ? ` (заблокировано: ${blocked})` : ''}${transition.canOverride ? ', обходимо с причиной' : ''}`;
    });
    return {
      text: finalize(
        listBlock(
          'Переходы письма',
          rows.filter((row): row is string => row !== null),
          { maxRows: 20 },
        ),
      ),
    };
  },
});

const relationsInput = z.object({ id: z.uuid() });

export const lettersRelationsTool = defineTool({
  id: 'letters.relations',
  title: 'Письма: связи',
  description:
    'Связанные письма по id: ответы, предки по почтовой цепочке, приложенные номера. Отвечает на «есть ли ответ», «вся переписка по вопросу».',
  keywords: ['связи', 'ответ', 'переписка', 'цепочка', 'relations', 'тред'],
  module: 'letters',
  kind: 'read',
  featureFlag: 'correspondence',
  hot: false,
  input: relationsInput,
  api: { method: 'GET', path: '/letters/:id/tree' },
  build: (input) => ({ path: `/letters/${input.id}/tree` }),
  project: (data) => {
    const root = asRecord(data);
    const nodes = asArray(root?.items ?? root?.tree ?? data);
    const rows = nodes.map((raw) => {
      const node = asRecord(raw);
      if (!node) return null;
      const letter = asRecord(node.letter) ?? node;
      return `${str(letter.regNumber) ? `№${str(letter.regNumber)}` : 'без номера'} «${str(letter.subject) ?? '(без темы)'}» — ${str(node.relation) ?? str(node.kind) ?? 'связь'}`;
    });
    return {
      text: finalize(
        listBlock(
          'Связанные письма',
          rows.filter((row): row is string => row !== null),
          {
            maxRows: 20,
          },
        ),
      ),
    };
  },
});

const attachmentsInput = z.object({ id: z.uuid() });

export const lettersAttachmentsTool = defineTool({
  id: 'letters.attachments',
  title: 'Письма: вложения',
  description:
    'Метаданные вложений письма по id: имя файла, формат (MIME), размер, дата. Содержимое файлов не читается и не показывается — только опись.',
  keywords: ['вложения', 'файлы', 'документы', 'опись', 'attachments'],
  module: 'letters',
  kind: 'read',
  featureFlag: 'correspondence',
  hot: true,
  input: attachmentsInput,
  /** Отдельного маршрута вложений нет: опись берётся из карточки письма. */
  api: { method: 'GET', path: '/letters/:id' },
  build: (input) => ({ path: `/letters/${input.id}` }),
  project: (data, input) => {
    const letter = asRecord(data);
    const attachments = asArray(letter?.attachments);
    if (attachments.length === 0) return { text: 'У письма нет вложений' };
    const rows = attachments.map((raw) => {
      const file = asRecord(raw);
      if (!file) return null;
      const size = num(file.size);
      return [
        str(file.name) ?? 'файл',
        str(file.mime) ?? 'формат неизвестен',
        size !== null ? `${Math.round(size / 1024)} КБ` : 'размер неизвестен',
        str(file.createdAt) ? dateTime(file.createdAt) : null,
        file.confidential ? 'конфиденциально' : null,
      ]
        .filter(Boolean)
        .join(', ');
    });
    return {
      text: finalize(
        listBlock(
          'Вложения письма (только метаданные)',
          rows.filter((row): row is string => row !== null),
          { maxRows: 30 },
        ),
      ),
      entity: entityLink('letter', input.id, 'Письмо'),
    };
  },
});

export const lettersTools = [
  lettersListTool,
  lettersGetTool,
  lettersTransitionsTool,
  lettersRelationsTool,
  lettersAttachmentsTool,
];
