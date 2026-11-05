import { Archive, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ContactPerson } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';

import {
  useCanCreateCounterparties,
  useCanManageCounterparties,
} from '../../../shared/counterparties/use-crm-permissions.js';
import { DataTable } from '../../../shared/views/data-table.js';
import { ListToolbar } from '../../../shared/views/list-toolbar.js';
import type { ActiveListFilter, FilterFieldDef } from '../../../shared/views/list-filters.js';
import type { RowMenuItem } from '../../../shared/views/row-menu.js';
import { useFilteredList, useListToolbar } from '../../../shared/views/use-list-toolbar.js';
import { useRowSelection } from '../../../shared/views/use-row-selection.js';
import { ViewSettings } from '../../../shared/views/view-settings.js';
import { useDeleteContactPerson, useSetContactArchived } from '../api/counterparty-edit.js';
import { contactFields } from '../lib/contact-fields.js';
import { ContactBulkIsland } from './contact-bulk-island.js';
import { ContactFormDialog } from './contact-form.js';

const VIEW_KEY = 'crm.contacts';
const noFilterDefs: FilterFieldDef<ContactPerson>[] = [];

function contactSearchText(c: ContactPerson): string {
  return [c.fullName, c.position, c.phone, c.email].filter(Boolean).join(' ');
}

/** Состояние окна: закрыто | новое | правка конкретного контакта. */
type FormState = { mode: 'closed' } | { mode: 'create' } | { mode: 'edit'; contact: ContactPerson };

/**
 * Вкладка «Контакты» правой зоны карточки контрагента (#460) — полноценный
 * список по единому стандарту («модули не отличаются»): строка инструментов
 * («Создать» слева от поиска — закон кнопки создания, шестерёнка полей) над
 * канонической таблицей. Контакт — сущность со своими полями (модель
 * Битрикс24), отсюда колонки, а не плитки. Меню строки — полный набор команд
 * (канон меню строки): «Изменить», «В архив»/«Вернуть», «Удалить» (с
 * подтверждением); клик по строке — правка. Права: `crm.create` — создание,
 * `crm.manage` — правка/архив/удаление; архивная карточка — только чтение.
 * Архивные контакты — в конце списка с пометкой.
 */
export function CounterpartyContactsTab({
  counterpartyId,
  contacts,
  readOnly,
}: {
  counterpartyId: string;
  contacts: ContactPerson[];
  /** Контрагент в архиве — вкладка только читается. */
  readOnly: boolean;
}) {
  const canAdd = useCanCreateCounterparties() && !readOnly;
  const canManage = useCanManageCounterparties() && !readOnly;
  const setArchived = useSetContactArchived(counterpartyId);
  const remove = useDeleteContactPerson(counterpartyId);
  const [form, setForm] = useState<FormState>({ mode: 'closed' });
  const [deleting, setDeleting] = useState<ContactPerson | null>(null);

  const toolbar = useListToolbar(VIEW_KEY);
  const filter = useMemo<ActiveListFilter<ContactPerson>>(
    () => ({
      defs: noFilterDefs,
      state: toolbar.filters,
      query: toolbar.query,
      searchText: contactSearchText,
    }),
    [toolbar.filters, toolbar.query],
  );
  const ordered = useMemo(
    () =>
      contacts.toSorted((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null)),
    [contacts],
  );
  const rows = useFilteredList(ordered, filter);
  // Массовые действия — общий островок (как в реестре контрагентов и задачах):
  // выбор ведёт DataTable, действия зависят от состава выделения.
  const selection = useRowSelection(rows.map((contact) => contact.id));
  const selectedRows = rows.filter((contact) => selection.selected.has(contact.id));
  const hasActive = selectedRows.some((contact) => contact.archivedAt === null);
  const hasArchived = selectedRows.some((contact) => contact.archivedAt !== null);

  const rowMenu = (contact: ContactPerson): RowMenuItem[] => {
    if (!canManage) return [];
    const archived = contact.archivedAt !== null;
    return [
      ...(archived
        ? []
        : [
            {
              id: 'edit',
              icon: <Pencil className="size-3.5" />,
              label: ui.counterparties.edit,
              onSelect: () => setForm({ mode: 'edit', contact }),
            },
          ]),
      {
        id: archived ? 'restore' : 'archive',
        icon: archived ? <RotateCcw className="size-3.5" /> : <Archive className="size-3.5" />,
        label: archived ? ui.counterparties.contactRestore : ui.counterparties.contactArchive,
        onSelect: () => setArchived.mutate({ contactId: contact.id, archived: !archived }),
      },
      {
        id: 'delete',
        icon: <Trash2 className="size-3.5" />,
        label: ui.counterparties.delete,
        danger: true,
        separatorBefore: true,
        onSelect: () => setDeleting(contact),
      },
    ];
  };

  return (
    <div className="relative flex h-full flex-col">
      <ListToolbar
        toolbar={toolbar}
        defs={noFilterDefs}
        left={
          canAdd ? (
            <Button onClick={() => setForm({ mode: 'create' })}>
              <Plus data-icon="inline-start" />
              {ui.common.create}
            </Button>
          ) : undefined
        }
        right={<ViewSettings viewKey={VIEW_KEY} defs={contactFields} />}
      />
      <div className="min-h-0 flex-1">
        <DataTable
          viewKey={VIEW_KEY}
          defs={contactFields}
          rows={rows}
          rowKey={(contact) => contact.id}
          emptyTitle={ui.counterparties.noContacts}
          selection={selection}
          rowMenu={rowMenu}
          onOpenRow={(contact) => {
            if (canManage && contact.archivedAt === null) setForm({ mode: 'edit', contact });
          }}
        />
      </div>

      <ContactBulkIsland
        counterpartyId={counterpartyId}
        selectedIds={selectedRows.map((contact) => contact.id)}
        hasActive={hasActive}
        hasArchived={hasArchived}
        visible={selectedRows.length > 0}
        onClear={selection.clear}
      />

      {form.mode === 'closed' ? null : (
        <ContactFormDialog
          counterpartyId={counterpartyId}
          contact={form.mode === 'edit' ? form.contact : null}
          onClose={() => setForm({ mode: 'closed' })}
        />
      )}

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{ui.counterparties.contactDeleteConfirmTitle}</DialogTitle>
            <DialogDescription>{ui.counterparties.contactDeleteConfirmText}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              {ui.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => {
                if (!deleting) return;
                remove.mutate(deleting.id, {
                  onSuccess: () => {
                    selection.deselect(deleting.id);
                    setDeleting(null);
                  },
                });
              }}
            >
              {ui.counterparties.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
