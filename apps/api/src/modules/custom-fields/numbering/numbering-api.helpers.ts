import {
  renderNumberTemplate,
  type NumberContainerMissingReason,
  type NumberFieldSegment,
  type NumberHostSample,
  type NumberSeriesRule,
} from '@nodus/contracts';

import { companyDay, companyMonth, companyYear } from '../../../core/time/company-time.js';
import type { FieldDefinitionRow } from '../definitions/definition.mapper.js';
import type { NumberHostRecord } from '../ports/number-host.port.js';

/** Чистые помощники API счетов (#630): место записи, читатель полей-вставок,
 *  рендер и примеры — без состояния и БД. */
export function participantsOf(definition: FieldDefinitionRow): string[] {
  return [
    ...definition.bindings.filter((b) => b.targetKind === 'process_type').map((b) => b.targetId),
    ...definition.bindings.filter((b) => b.targetKind === 'project_type').map((b) => b.targetId),
    ...definition.bindings.filter((b) => b.targetKind === 'node_kind').map((b) => b.targetId),
  ];
}

export function placeOf(host: NumberHostRecord, definitions: readonly FieldDefinitionRow[]) {
  const byNumber = new Map(definitions.map((row) => [row.number, row]));
  return {
    host: host.target.host,
    typeId: host.target.typeId,
    folders: host.target.folders,
    projectId: host.target.projectId,
    portfolioId: host.target.portfolioId,
    projectTypeId: host.target.projectTypeId,
    parentTaskId: host.target.parentTaskId,
    fieldValue: (fieldNumber: number) => {
      const fieldId = byNumber.get(fieldNumber)?.id;
      const value = fieldId ? host.target.sources.self[fieldId] : undefined;
      return typeof value === 'string' && value.length > 0 ? value : null;
    },
  };
}

export function readerOf(
  host: NumberHostRecord,
  definitions: readonly FieldDefinitionRow[],
  companyByNumber: ReadonlyMap<number, string> = new Map(),
): (segment: NumberFieldSegment) => string {
  const byNumber = new Map(definitions.map((row) => [row.number, row]));
  const valueOf = (values: Record<string, unknown> | null | undefined, number: number) => {
    const fieldId = byNumber.get(number)?.id;
    const value = fieldId ? values?.[fieldId] : undefined;
    return typeof value === 'string' ? value : '';
  };
  return (segment) => {
    switch (segment.source) {
      case 'self':
        return valueOf(host.target.sources.self, segment.fieldNumber);
      case 'project':
        return valueOf(host.target.sources.project, segment.fieldNumber);
      case 'parent_task':
        return valueOf(host.target.sources.parentTask, segment.fieldNumber);
      case 'folder': {
        const folder = host.target.sources.folders?.find(
          (entry) => entry.kindId === segment.nodeKindId,
        );
        return valueOf(folder?.values, segment.fieldNumber);
      }
      case 'company':
        return companyByNumber.get(segment.fieldNumber) ?? '';
    }
  };
}

export function nameOfSegment(
  segment: NumberFieldSegment,
  definitions: readonly FieldDefinitionRow[],
): string {
  return definitions.find((row) => row.number === segment.fieldNumber)?.name ?? '—';
}

export function render(
  rule: NumberSeriesRule,
  seq: number,
  reader: (segment: NumberFieldSegment) => string = () => '…',
): string {
  return renderNumberTemplate(rule.template, { seq, ...momentNow(), field: reader });
}

export function momentNow() {
  const now = new Date();
  return { year: companyYear(now), month: companyMonth(now), day: companyDay(now) };
}

export function sampleOf(
  host: NumberHostRecord,
  reason: NumberContainerMissingReason,
): NumberHostSample {
  return { kind: host.kind, id: host.id, name: host.name, reason };
}
