import { Check, Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ContactRef } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverAnchor, PopoverContent } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { useAddContactPerson } from '../../../../shared/counterparties/mutations.js';
import { useCounterpartyCard } from '../../../../shared/counterparties/queries.js';
import { useCanManageCounterparties } from '../../../../shared/counterparties/use-crm-permissions.js';
import { useActiveOption } from '../../../../shared/ui/use-active-option.js';

/**
 * Подписант (#55): контакт корреспондента — список его действующих
 * контактов с фильтром по ФИО и «Создать контакт» прямо в поле (право
 * `crm.manage`; контакт сразу выбирается). Без корреспондента поле спит.
 */
export function SignerField({
  counterpartyId,
  value,
  onChange,
  id,
  invalid,
  describedBy,
  autoFocus,
  onDismiss,
}: {
  counterpartyId: string | null;
  value: ContactRef | null;
  onChange: (contact: ContactRef | null) => void;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
  /** Список закрыт без выбора — правка по месту в карточке выходит из ввода. */
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ fullName: '', position: '' });
  const anchorRef = useRef<HTMLDivElement>(null);
  const fromPointer = useRef(false);
  const { data: card } = useCounterpartyCard(counterpartyId ?? '');
  const addContact = useAddContactPerson(counterpartyId ?? '');
  const canCreate = useCanManageCounterparties();

  const q = text.trim().toLowerCase();
  const contacts = (card?.contactPersons ?? []).filter(
    (person) =>
      person.archivedAt === null &&
      !person.id.startsWith('temp-') &&
      (q === '' || person.fullName.toLowerCase().includes(q)),
  );
  const entries: (ContactRef | 'create')[] = [
    ...contacts.map((p) => ({ id: p.id, fullName: p.fullName, position: p.position })),
    ...(canCreate ? (['create'] as const) : []),
  ];
  const nav = useActiveOption(entries.length, `${open}:${q}:${entries.length}`);

  function choose(contact: ContactRef | null) {
    onChange(contact);
    setText('');
    setOpen(false);
    setCreating(false);
  }

  function startCreate() {
    setDraft({ fullName: text.trim(), position: '' });
    setCreating(true);
  }

  function submitContact() {
    const fullName = draft.fullName.trim();
    if (!fullName || addContact.isPending) return;
    addContact.mutate(
      { fullName, position: draft.position.trim() || null },
      {
        onSuccess: (person) =>
          choose({ id: person.id, fullName: person.fullName, position: person.position }),
      },
    );
  }

  if (!counterpartyId) {
    return (
      <Input
        id={id}
        disabled
        value=""
        placeholder={ui.letters.form.signerNeedsCounterparty}
        aria-label={ui.letters.fields.signer}
        className="h-8 text-sm"
      />
    );
  }

  const shownValue = value ? [value.fullName, value.position].filter(Boolean).join(', ') : '';

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setText('');
          setCreating(false);
          onDismiss?.();
        }
      }}
    >
      <PopoverAnchor asChild>
        <div ref={anchorRef} className="relative min-w-0">
          <Input
            id={id}
            value={open ? text : shownValue}
            placeholder={ui.letters.form.signerPlaceholder}
            aria-label={ui.letters.fields.signer}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            aria-expanded={open}
            role="combobox"
            autoComplete="off"
            autoFocus={autoFocus}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
              setCreating(false);
            }}
            onPointerDown={() => {
              fromPointer.current = true;
            }}
            onFocus={() => {
              if (!fromPointer.current) setOpen(true);
            }}
            onClick={() => {
              fromPointer.current = false;
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && open) {
                e.preventDefault();
                setOpen(false);
                onDismiss?.();
                return;
              }
              nav.onKeyDown(e, {
                onPick: (index) => {
                  const entry = entries[index];
                  if (entry === 'create') startCreate();
                  else if (entry) choose(entry);
                },
                onOpen: () => setOpen(true),
                enabled: open,
              });
            }}
            className={cn('h-8 text-sm', value && !open && 'pr-7')}
          />
          {value && !open ? (
            <button
              type="button"
              onClick={() => choose(null)}
              aria-label={`${ui.filters.reset}: ${ui.letters.fields.signer}`}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (anchorRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
        className="w-(--radix-popover-anchor-width) p-1"
      >
        {creating ? (
          <form
            className="flex flex-col gap-2 p-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              submitContact();
            }}
          >
            <Input
              autoFocus
              value={draft.fullName}
              onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))}
              placeholder={ui.letters.form.contactName}
              aria-label={ui.letters.form.contactName}
              className="h-8 text-sm"
            />
            <Input
              value={draft.position}
              onChange={(e) => setDraft((d) => ({ ...d, position: e.target.value }))}
              placeholder={ui.letters.form.contactPosition}
              aria-label={ui.letters.form.contactPosition}
              className="h-8 text-sm"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreating(false)}>
                {ui.common.cancel}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!draft.fullName.trim() || addContact.isPending}
              >
                {ui.letters.form.contactSave}
              </Button>
            </div>
          </form>
        ) : (
          <div
            role="listbox"
            aria-label={ui.letters.fields.signer}
            className="max-h-60 overflow-y-auto"
          >
            {entries.map((entry, index) =>
              entry === 'create' ? (
                <button
                  key="create"
                  type="button"
                  data-active={index === nav.active || undefined}
                  onClick={startCreate}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-info hover:bg-accent/60',
                    index === nav.active && 'bg-accent/60',
                  )}
                >
                  <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
                  {ui.letters.form.createContact}
                </button>
              ) : (
                <button
                  key={entry.id}
                  type="button"
                  role="option"
                  aria-selected={entry.id === value?.id}
                  data-active={index === nav.active || undefined}
                  onClick={() => choose(entry)}
                  onPointerMove={() => nav.setActive(index)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-accent/60',
                    index === nav.active && 'bg-accent/60',
                    entry.id === value?.id ? 'text-port' : 'text-secondary-foreground',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.fullName}</span>
                  {entry.position ? (
                    <span className="max-w-[45%] shrink-0 truncate text-label-sm text-muted-foreground">
                      {entry.position}
                    </span>
                  ) : null}
                  {entry.id === value?.id ? (
                    <Check className="size-3.5 shrink-0" strokeWidth={1.75} />
                  ) : null}
                </button>
              ),
            )}
            {contacts.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {ui.letters.form.signerEmpty}
              </p>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
