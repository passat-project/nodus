import { z } from 'zod';

import type { ProcessType } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { asArray, asTyped, finalize, listBlock, str } from '../projections.js';

/**
 * Инструмент «Процессов» (#892): типы процессов (задач и писем) с их
 * категориями и признаками. Отвечает на «какие виды поручений есть»,
 * «в каком процессе создать задачу».
 */

const input = z.object({
  category: z.enum(['task', 'letter']).optional(),
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
});

export const workflowsProcessTypesTool = defineTool({
  id: 'workflows.process_types',
  title: 'Процессы: типы',
  description:
    'Типы процессов портала: названия, категория (задача или письмо), архивность. Нужны, чтобы предложить правильный вид поручения и назвать его как в портале.',
  keywords: ['процессы', 'типы', 'виды задач', 'маршруты', 'категории', 'process types'],
  module: 'workflows',
  kind: 'read',
  hot: false,
  input,
  api: { method: 'GET', path: '/workflows/types' },
  build: (query) => ({
    path: '/workflows/types',
    query: {
      archived: query.archived,
      ...(query.category ? { category: query.category } : {}),
    },
  }),
  project: (data: ProcessType[]) => {
    const rows = asArray(data).map((raw) => {
      const type = asTyped<ProcessType>(raw);
      if (!type) return null;
      const category = type.category === 'letter' ? 'письмо' : 'задача';
      // Архивирование в контракте — `archivedAt` (processTypeSchema), не
      // булев `archived`: иначе модель считает архивный тип действующим.
      const archivedLabel = str(type.archivedAt) ? ' — архивный' : '';
      return `${str(type.name) ?? '—'} — категория ${category}${type.isSystem ? ', системный' : ''}${archivedLabel}`;
    });
    return {
      text: finalize(
        listBlock(
          'Типы процессов',
          rows.filter((row): row is string => row !== null),
          {
            maxRows: 40,
          },
        ),
      ),
    };
  },
});

export const workflowsTools = [workflowsProcessTypesTool];
