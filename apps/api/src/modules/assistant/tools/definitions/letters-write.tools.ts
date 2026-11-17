import { z } from 'zod';

import { defineTool } from '../tool-definition.js';
import type { ToolContext } from '../tool-definition.js';
import { asArray, asRecord, clip, str } from '../projections.js';
import { field, fieldsOf, humanDate, shortId, userName } from './write-cards.js';

/**
 * Действия по письмам (Ф2, ADR-0048): выполнение перехода маршрута —
 * резолюция, регистрация, дальнейшие шаги по кнопкам карточки письма.
 * Какие переходы доступны сотруднику, отвечает сам портал (гейты, роли,
 * права); карточка показывает название кнопки и целевую стадию.
 */

const transitionInput = z.object({
  letterId: z.uuid(),
  transitionId: z.uuid(),
  /** Поля окна перехода: описание поручения, срок, исполнитель. */
  description: z.string().trim().max(5000).optional(),
  deadline: z.iso.datetime().optional(),
  assigneeId: z.uuid().optional(),
  /** Причина обхода гейта — только при праве `task.override_gate`. */
  reason: z.string().trim().min(1).max(500).optional(),
});

export const lettersTransitionTool = defineTool({
  id: 'letters.transition',
  title: 'Письма: резолюция/переход',
  description:
    'Выполнить переход письма по id (кнопки маршрута из letters.transitions): резолюция с поручением, регистрация, дальнейшие шаги. Действие появится карточкой на подтверждение; доступность перехода и права проверяет портал.',
  keywords: [
    'резолюция',
    'переход',
    'кнопка маршрута',
    'зарегистрировать письмо',
    'поручение по письму',
    'resolution',
  ],
  module: 'letters',
  kind: 'write',
  featureFlag: 'correspondence',
  hot: true,
  input: transitionInput,
  api: { method: 'POST', path: '/letters/:id/transitions/:transitionId' },
  build: (input) => ({
    method: 'POST',
    path: `/letters/${input.letterId}/transitions/${input.transitionId}`,
    body: {
      ...(input.description || input.deadline || input.assigneeId
        ? {
            form: {
              fields: {
                ...(input.description ? { description: input.description } : {}),
                ...(input.deadline ? { deadline: input.deadline } : {}),
                ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
              },
            },
          }
        : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
  }),
  project: (data) => {
    const letter = asRecord(asRecord(data)?.letter);
    const id = str(letter?.id);
    if (!id) return { text: 'Переход выполнен' };
    const subject = str(letter?.subject);
    const number = str(letter?.number) ?? str(letter?.registeredNumber);
    return {
      text: `Письмо обновлено: ${number ? `№${number} ` : ''}«${subject ?? '—'}», id ${id}`,
      entity: {
        href: `?cards=letter:${id}`,
        label: `${number ? `№${number} ` : ''}${subject ?? 'Письмо'}`.trim(),
      },
    };
  },
  card: {
    title: 'Переход по письму',
    summary: async (input, ctx) => {
      const [letter, transition] = await Promise.all([
        readLetter(ctx, input.letterId),
        readTransition(ctx, input.letterId, input.transitionId),
      ]);
      const action = transition?.name ?? 'переход';
      const letterLabel = letter
        ? `письмо ${letter.number ? `№${letter.number} ` : ''}«${letter.subject}»`
        : `письмо id ${shortId(input.letterId)}`;
      return `${action}: ${letterLabel}${transition?.toStageName ? ` → «${transition.toStageName}»` : ''}`;
    },
    fields: async (input, ctx) => {
      const [letter, transition, assignee] = await Promise.all([
        readLetter(ctx, input.letterId),
        readTransition(ctx, input.letterId, input.transitionId),
        input.assigneeId ? userName(ctx, input.assigneeId) : Promise.resolve(null),
      ]);
      return fieldsOf([
        field(
          'Письмо',
          letter
            ? `${letter.number ? `№${letter.number} ` : ''}«${letter.subject}»`
            : input.letterId,
        ),
        field('Действие', transition?.name ?? `id ${shortId(input.transitionId)}`),
        field('Новая стадия', transition?.toStageName),
        field('Поручение', input.description ? clip(input.description, 500) : null),
        field('Исполнитель', assignee ?? input.assigneeId),
        field('Срок', humanDate(input.deadline)),
        field('Причина', input.reason),
      ]);
    },
    consequences:
      'Письмо перейдёт на следующую стадию маршрута, номер и история сохранятся. Переход необратим — отменить его автоматически нельзя.',
  },
});

interface LetterInfo {
  subject: string;
  number: string | null;
}

async function readLetter(ctx: ToolContext, id: string): Promise<LetterInfo | null> {
  try {
    const raw = asRecord(await ctx.read?.(`/letters/${id}`));
    const subject = str(raw?.subject);
    if (!subject) return null;
    return { subject, number: str(raw?.number) ?? str(raw?.registeredNumber) };
  } catch {
    return null;
  }
}

interface TransitionInfo {
  name: string;
  toStageName: string | null;
}

async function readTransition(
  ctx: ToolContext,
  letterId: string,
  transitionId: string,
): Promise<TransitionInfo | null> {
  try {
    for (const raw of asArray(await ctx.read?.(`/letters/${letterId}/transitions`))) {
      const transition = asRecord(raw);
      if (str(transition?.id) !== transitionId) continue;
      return {
        name: str(transition?.name) ?? 'переход',
        toStageName: str(transition?.toStageName),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export const lettersWriteTools = [lettersTransitionTool];
