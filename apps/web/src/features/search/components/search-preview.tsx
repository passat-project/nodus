import type { SearchHit } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

import { formatDateTime } from '../../../shared/lib/format.js';
import { searchReasonLabel, searchTypeIcon, searchTypeLabel } from '../lib/search-labels.js';
import { searchHitMeta, searchHitPrimary, searchHitSnippet } from './search-hit-row.js';
import { SnippetText } from './snippet-text.js';

/** Превью выбранного результата (рабочее окно): контекст, причины и
 *  открытие. Показывается только на широкой ширине (≥1100px) — композиция
 *  #952 §4c. */
export function SearchPreview({ hit, onOpen }: { hit: SearchHit | null; onOpen: () => void }) {
  if (!hit) {
    return (
      <aside className="hidden w-[320px] shrink-0 border-l border-border/60 p-4 text-sm text-muted-foreground min-[1100px]:block">
        {ui.search.previewEmpty}
      </aside>
    );
  }
  const Icon = searchTypeIcon(hit.type);
  const snippet = searchHitSnippet(hit);
  const rows = previewRows(hit);
  return (
    <aside className="hidden w-[320px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/60 p-4 min-[1100px]:flex">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" aria-hidden />
        {searchTypeLabel(hit.type)}
        <span className="ml-auto">{formatDateTime(hit.sourceCreatedAt)}</span>
      </div>
      <h2 className="text-base leading-snug font-semibold">{searchHitPrimary(hit)}</h2>
      {snippet !== null ? (
        <SnippetText text={snippet} className="text-sm leading-relaxed text-muted-foreground" />
      ) : null}
      <p className="text-xs text-muted-foreground">{searchHitMeta(hit)}</p>
      {rows.length > 0 ? (
        <dl className="flex flex-col gap-1.5 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-2">
              <dt className="w-28 shrink-0 text-muted-foreground">{label}</dt>
              <dd className="min-w-0 flex-1 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {hit.reasons.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {hit.reasons.map((reason) => (
            <span
              key={reason}
              className="rounded-full border border-border/70 px-1.5 py-px text-[10px] text-muted-foreground"
            >
              {searchReasonLabel(reason)}
            </span>
          ))}
        </div>
      ) : null}
      <Button size="sm" className="mt-auto" onClick={onOpen}>
        {ui.common.open}
      </Button>
    </aside>
  );
}

const fields = ui.search.fields;

function previewRows(hit: SearchHit): Array<[string, string]> {
  const rows: Array<[string, string | null | undefined]> = [];
  switch (hit.type) {
    case 'task':
      rows.push(
        [fields.number, hit.meta.number ? `ПП-${hit.meta.number}` : null],
        [fields.project, hit.meta.projectName],
        [fields.deadline, hit.meta.deadline ? formatDateTime(hit.meta.deadline) : null],
      );
      break;
    case 'letter':
      rows.push(
        [fields.number, hit.meta.regNumber],
        [fields.counterparty, hit.meta.counterpartyName],
        [fields.direction, hit.meta.direction === 'incoming' ? fields.incoming : fields.outgoing],
      );
      break;
    case 'message':
      rows.push(
        [fields.conversation, hit.meta.conversationLabel],
        [fields.author, hit.meta.authorName],
        [fields.created, formatDateTime(hit.meta.createdAt)],
      );
      break;
    case 'project':
      rows.push([fields.code, hit.meta.code], [fields.status, hit.meta.status]);
      break;
    case 'employee':
      rows.push(
        [fields.position, hit.meta.positionName],
        [fields.department, hit.meta.departmentName],
        [fields.email, hit.meta.email],
      );
      break;
  }
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}
