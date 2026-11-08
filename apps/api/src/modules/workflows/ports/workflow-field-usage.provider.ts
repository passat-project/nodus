import { Injectable } from '@nestjs/common';
import { customFieldKey, type NumberIssuer } from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../core/database/prisma.service.js';
import type {
  WorkflowCreationFormUsage,
  WorkflowFieldUsage,
  WorkflowFieldUsageReader,
} from './workflow-field-usage.port.js';

/**
 * Реализация порта использования атрибута в процессах (#631): ищет ключ
 * `cf.<uuid>` в документах маршрутов — в разделах окна перехода
 * (`form.sections[kind=fields].fields`), в валидаторах «Заполнены поля» и в
 * условиях решающих `decider_in` (источник «поле», Р8 #631). Оператор `?`
 * jsonb проверяет наличие элемента массива, сравнение идёт по точному ключу.
 * Маршруты — только опубликованные (черновик публикацией ещё не стал).
 * Формы создания считаются вместе с непубликуемыми черновиками: удаление
 * они не блокируют, но окно последствий обязано показать их (Review Focus
 * §9 #631) — `draft` различает черновик и опубликованную форму.
 */
@Injectable()
export class WorkflowFieldUsageProvider implements WorkflowFieldUsageReader {
  constructor(private readonly prisma: PrismaService) {}

  async workflowsUsingField(
    fieldId: string,
    opts: { typeId?: string } = {},
  ): Promise<WorkflowFieldUsage[]> {
    const key = customFieldKey(fieldId);
    return this.prisma.$queryRaw<WorkflowFieldUsage[]>(Prisma.sql`
      SELECT DISTINCT w.id, COALESCE(pt.name, w.name) AS name
      FROM workflows w
      JOIN workflow_transitions t
        ON t.workflow_id = w.id AND t.archived_at IS NULL
      LEFT JOIN workflow_scheme_entries se ON se.workflow_id = w.id
      LEFT JOIN process_types pt ON pt.id = se.process_type_id
      WHERE w.published_at IS NOT NULL
        AND w.kind IN ('task', 'letter')
        ${opts.typeId ? Prisma.sql`AND se.process_type_id = ${opts.typeId}::uuid` : Prisma.empty}
        AND (
          EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(t.form->'sections', '[]'::jsonb)) s
            WHERE t.form->>'enabled' = 'true'
              AND s->>'kind' = 'fields'
              AND s->'fields' ? ${key}
          )
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(t.rules->'validators', '[]'::jsonb)) v
            WHERE v->>'kind' = 'fields_required'
              AND v->'fields' ? ${key}
          )
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(t.rules->'conditions', '[]'::jsonb)) c
            WHERE c->>'kind' = 'decider_in'
              AND c->'source'->>'kind' = 'field'
              AND c->'source'->>'field' = ${key}
          )
        )
      ORDER BY name
    `);
  }

  async creationFormsUsingField(fieldId: string): Promise<WorkflowCreationFormUsage[]> {
    const key = customFieldKey(fieldId);
    return this.prisma.$queryRaw<WorkflowCreationFormUsage[]>(Prisma.sql`
      SELECT DISTINCT w.kind, COALESCE(pt.name, w.name) AS name,
             (w.published_at IS NULL) AS draft
      FROM workflows w
      LEFT JOIN workflow_scheme_entries se ON se.workflow_id = w.id
      LEFT JOIN process_types pt ON pt.id = se.process_type_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(w.creation->'fields', '[]'::jsonb)) f
      WHERE w.kind IN ('task', 'letter')
        AND f->>'key' = ${key}
      ORDER BY name
    `);
  }

  async formulaSlotsUsingField(fieldId: string): Promise<number> {
    const key = customFieldKey(fieldId);
    const rows = await this.prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT (
        (SELECT COUNT(*) FROM workflow_transitions t
          JOIN workflows w ON w.id = t.workflow_id
          WHERE t.archived_at IS NULL
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(t.form->'sections', '[]'::jsonb)) s
              WHERE s->>'kind' = 'fields'
                AND s->'formulas' ? ${key}
            ))
        +
        (SELECT COUNT(*) FROM workflows w
          WHERE w.kind IN ('task', 'letter')
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(COALESCE(w.creation->'fields', '[]'::jsonb)) f
              WHERE f->>'key' = ${key} AND f->'formula' IS NOT NULL
            ))
      )::int AS count
    `);
    return rows[0]?.count ?? 0;
  }

  async numberIssuers(fieldId: string): Promise<NumberIssuer[]> {
    return this.prisma.$queryRaw<NumberIssuer[]>(Prisma.sql`
      SELECT DISTINCT se.process_type_id AS "processTypeId",
             t.id::text AS "transitionId",
             t.name AS "transitionName"
      FROM workflows w
      JOIN workflow_transitions t
        ON t.workflow_id = w.id AND t.archived_at IS NULL
      JOIN workflow_scheme_entries se ON se.workflow_id = w.id
      WHERE w.published_at IS NOT NULL
        AND w.kind IN ('task', 'letter')
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(t.rules->'postFunctions', '[]'::jsonb)) pf
          WHERE pf->>'kind' = 'assign_number'
            AND pf->>'fieldId' = ${fieldId}
        )
      ORDER BY t.name
    `);
  }
}
