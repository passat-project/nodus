import { z } from 'zod';

import { defineTool } from '../tool-definition.js';
import {
  asArray,
  asRecord,
  date,
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
 * связи-ответы и вложения.
 *
 * Границы данных (ADR-0043 п. 8, ADR-0044 п. 5, ADR-0050): подписанные ссылки
 * (`url`, `pdfUrl`) и тело письма наружу не отдаются. Вложения — метаданные
 * (имя, формат, размер, роль) + `fileId`: по нему `files.extract_text` читает
 * текст PDF/DOCX, кроме конфиденциальных писем — их не читает ИИ ни при каком
 * режиме (граница эпика #889, тест `letters-attachments.test.ts`).
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
    // Ссылка «Открыть» — у карточки письма (letters.get), не у списка.
    return { text: finalize(listBlock('Письма', rows, { more: hasMore(data) })) };
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
      `Вложений: ${attachments.length} (PDF/DOCX читает files.extract_text по fileId)`,
      ...attachments
        .slice(0, 10)
        .map((raw) => {
          const file = asRecord(raw);
          if (!file) return null;
          const size = num(file.size);
          const fileId = str(file.fileId);
          return `— ${str(file.name) ?? 'файл'}, ${str(file.mime) ?? '—'}, ${size ? `${Math.round(size / 1024)} КБ` : 'размер неизвестен'}${fileId ? `, файл ${fileId}` : ''}`;
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
    // Форма `GET /letters/:id/tree` — `{ root: { children: […] }, truncated }`
    // (контракт letterTreeResponseSchema): обходим дерево в глубину, а не
    // читаем плоский список (иначе «связей нет» на любой переписке).
    const root = asRecord(asRecord(data)?.root);
    const truncated = asRecord(data)?.truncated === true;
    const rows: string[] = [];
    const walk = (node: Record<string, unknown> | null, depth: number): void => {
      for (const raw of asArray(node?.children)) {
        const child = asRecord(raw);
        if (!child) continue;
        const reg = str(child.regNumber) ? `№${str(child.regNumber)}` : 'без номера';
        const subject = str(child.subject) ?? '(без темы)';
        const kind = str(child.relationKind) === 'reply_to' ? 'ответ' : 'вложено в цепочку';
        rows.push(`${'  '.repeat(depth)}${reg} «${subject}» — ${kind}`);
        walk(child, depth + 1);
      }
    };
    walk(root, 0);
    if (truncated) rows.push('… дерево обрезано: показаны не все связи');
    return {
      text: finalize(listBlock('Связанные письма', rows, { maxRows: 20 })),
    };
  },
});

const attachmentsInput = z.object({ id: z.uuid() });

export const lettersAttachmentsTool = defineTool({
  id: 'letters.attachments',
  title: 'Письма: вложения',
  description:
    'Метаданные вложений письма по id: имя файла, формат (MIME), размер, роль и fileId. Текст PDF/DOCX читается отдельно — files.extract_text по fileId; конфиденциальные письма ассистенту не читаются.',
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
      const fileId = str(file.fileId);
      // Форма `letterAttachmentSchema`: name/mime/size/role/inline/fileId.
      // Подписанные `url`/`pdfUrl` не выводятся — только опись и id файла
      // для files.extract_text. Конфиденциальность — у письма, не у файла.
      const role =
        str(file.role) === 'main'
          ? 'основной документ'
          : str(file.role) === 'body_pdf'
            ? 'PDF-копия тела'
            : file.inline === true
              ? 'встроено в тело'
              : 'вложение';
      return [
        str(file.name) ?? 'файл',
        str(file.mime) ?? 'формат неизвестен',
        size !== null ? `${Math.round(size / 1024)} КБ` : 'размер неизвестен',
        role,
        fileId ? `fileId ${fileId}` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(', ');
    });
    return {
      text: finalize(
        listBlock(
          'Вложения письма (метаданные; текст — files.extract_text по fileId)',
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
