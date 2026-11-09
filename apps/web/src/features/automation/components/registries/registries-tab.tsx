import { useMemo, useState } from 'react';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { LayoutTemplate } from 'lucide-react';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import { AttributeWindowBuilder } from '../../../../shared/forms/attribute-window-builder.js';
import type { AttributeElement } from '../../../../shared/forms/attribute-form-model.js';
import { NodeLabel } from '@nodus/ui/components/node-label';

const r = ui.forms.registries;

/**
 * Вкладка «Реестры» — заготовка (#496, Р12; настоящие реестры — #636):
 * демо-вид «Выдачи заданий» и его строка, которую правит ТОТ ЖЕ редактор
 * окон. Данные демонстрационные, хранение — в памяти экрана; API подключит
 * #636 тем же контрактом формы атрибутов.
 */
export function RegistriesTab() {
  const definitions = useCustomFieldDefinitions('task');
  const [elements, setElements] = useState<AttributeElement[] | null>(null);
  const [open, setOpen] = useState(false);
  const demo = useMemo(
    () => elements ?? demoForm(definitions.data ?? []),
    [elements, definitions.data],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-base font-semibold">{r.tab}</h1>
          <p className="text-sm text-muted-foreground">{r.lead}</p>
        </div>
        <div className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex h-14 min-w-0 items-center gap-3 px-4">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.demoName}</span>
            <span className="text-xs text-muted-foreground">
              {r.rows}: {r.demoRows}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
              <LayoutTemplate className="size-3.5" strokeWidth={1.75} />
              {r.editRow}
            </Button>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-4 gap-y-2 border-t border-border px-4 py-3">
            <NodeLabel label={ui.tasks.assignee} />
            <span className="text-sm">{r.demoAssignee}</span>
            <NodeLabel label={ui.tasks.deadline} />
            <span className="text-sm text-muted-foreground">—</span>
          </div>
        </div>
      </div>
      <AttributeWindowBuilder
        open={open}
        title={`${ui.forms.builder.titles.registry} · ${r.demoName}`}
        elements={demo}
        definitions={definitions.data ?? []}
        formulaHostKind="task"
        readOnly={false}
        onDone={(next) => {
          setElements(next);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

/** Демо-форма строки: первые три атрибута области задач и заголовок. */
function demoForm(definitions: readonly CustomFieldDefinition[]): AttributeElement[] {
  const fields = definitions.slice(0, 3).map((definition) => ({
    fieldId: definition.id,
    state: definition.type === 'counterparty' ? ('required' as const) : ('optional' as const),
  }));
  return [{ kind: 'heading', id: 'dreg0001', text: 'Данные выдачи' }, ...fields];
}
