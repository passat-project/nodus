import { Injectable } from '@nestjs/common';
import { WORKFLOW_EVENTS, customFieldKey } from '@nodus/contracts';

import { Prisma } from '../../../generated/prisma/client.js';
import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import { EventBus } from '../../../core/events/event-bus.js';
import type { ProcessTypeFormCleaner } from './process-type-form-cleaner.port.js';

/**
 * Уборка слота `cf.<id>` из форм создания маршрутов (#646). Форма создания —
 * часть опубликованного документа (`workflows.creation`), поэтому чистит её
 * владелец таблицы. После изменения — каталожное `workflow.type_updated` на
 * каждый затронутый тип: клиенты перечитывают типы и форму создания без F5.
 *
 * Идемпотентно: повторный вызов не находит ключа и ничего не эмитит.
 */
@Injectable()
export class ProcessTypeFormCleanerProvider implements ProcessTypeFormCleaner {
  constructor(private readonly eventBus: EventBus) {}

  async removeFieldFromCreationForms(
    fieldId: string,
    actorId: string | null,
    tx: TransactionClient,
  ): Promise<{ typeId: string; name: string }[]> {
    const key = customFieldKey(fieldId);
    const changed = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE "workflows" w
      SET "creation" = jsonb_set(w."creation", '{fields}', (
        SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(w."creation"->'fields') WITH ORDINALITY AS t(e, ord)
        WHERE e->>'key' IS DISTINCT FROM ${key}
      ))
      WHERE jsonb_typeof(w."creation"->'fields') = 'array'
        AND w."creation"->'fields' @> jsonb_build_array(
          jsonb_build_object('key', ${key}::text)
        )
      RETURNING w."id"
    `);
    if (changed.length === 0) return [];
    const ids = changed.map((row) => row.id);
    const types = await tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`
      SELECT DISTINCT pt."id", pt."name"
      FROM "process_types" pt
      JOIN "workflow_scheme_entries" se ON se."process_type_id" = pt."id"
      WHERE se."workflow_id" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY pt."name"
    `);
    for (const type of types) {
      await this.eventBus.emit(
        tx,
        WORKFLOW_EVENTS.TYPE_UPDATED,
        { typeId: type.id, fields: ['creation'] },
        { actorId, aggregateType: 'process_type', aggregateId: type.id },
      );
    }
    return types.map((type) => ({ typeId: type.id, name: type.name }));
  }
}
