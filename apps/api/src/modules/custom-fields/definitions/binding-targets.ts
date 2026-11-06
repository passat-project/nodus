import { ErrorCode } from '@nodus/contracts';

import type { ProcessCatalogReader } from '../../workflows/ports/process-catalog-reader.port.js';
import type { FieldBindingTargetReader } from '../../projects/ports/field-binding-targets.port.js';
import { DomainException } from '../../../core/errors/domain-exception.js';

/** Вид цели привязки из пути API (`PUT/DELETE .../bindings/:kind/:targetId`). */
export type BindingTargetKind = 'process-type' | 'project-type' | 'node-kind';

/** Вид цели в таблице `field_bindings`. */
export type BindingRowKind = 'process_type' | 'project_type' | 'node_kind';

export function bindingRowKind(kind: BindingTargetKind): BindingRowKind {
  if (kind === 'process-type') return 'process_type';
  if (kind === 'project-type') return 'project_type';
  return 'node_kind';
}

/**
 * Цели привязки «Где используется» (Р3 #631) — одна проверка на все пути
 * записи (создание/правка с `bindings`, точечные PUT/DELETE, формы мест):
 * цель существует, тип процесса — живой (не архивный). Атрибут задачи и
 * письма привязывается к типам обеих категорий — ограничений по категории
 * больше нет (одно определение на портал). Критерии по видам: тип проекта —
 * существует; вид папки — включая архивные (формы архивных видов живут).
 *
 * Неизвестная цель — 404 (не раскрываем существование чужих справочников),
 * архивный тип процесса — 422 `CUSTOM_FIELD_BINDING_INVALID`.
 */
export async function assertTargetsBindable(
  catalog: ProcessCatalogReader,
  targets: FieldBindingTargetReader,
  kind: BindingTargetKind,
  targetIds: readonly string[],
  opts: { allowArchived?: ReadonlySet<string> } = {},
): Promise<void> {
  const unique = [...new Set(targetIds)];
  if (unique.length === 0) return;

  if (kind === 'process-type') {
    const refs = await catalog.typeRefs(unique);
    const known = new Map(refs.map((ref) => [ref.id, ref]));
    const missing = unique.filter((id) => !known.has(id));
    if (missing.length > 0) {
      throw DomainException.notFound('Process type not found', { typeIds: missing });
    }
    const live = new Set((await catalog.typeRefs(unique, { live: true })).map((ref) => ref.id));
    // Архивная цель, уже стоящая в привязках, остаётся допустимой при
    // сохранении полного набора (иначе окно атрибута нельзя сохранить —
    // #646); новую привязку к архиву по-прежнему запрещаем.
    const invalid = unique.filter((id) => !live.has(id) && !opts.allowArchived?.has(id));
    if (invalid.length > 0) {
      throw new DomainException(
        ErrorCode.CUSTOM_FIELD_BINDING_INVALID,
        'Field cannot be bound to archived process types',
        { typeIds: invalid },
      );
    }
    return;
  }

  const rows = kind === 'project-type' ? await targets.projectTypes() : await targets.nodeKinds();
  const known = new Set(rows.map((row) => row.id));
  const missing = unique.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw DomainException.notFound(
      kind === 'project-type' ? 'Project type not found' : 'Node kind not found',
      { targetIds: missing },
    );
  }
}
