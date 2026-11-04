import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CustomFieldDefinition, CustomFieldScope } from '@nodus/contracts';
import { ErrorCode, errorMessages, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';

import { ApiError } from '../../../../shared/api-client.js';
import { useCanManageDictionaries } from '../../../../shared/custom-fields/use-can-manage-dictionaries.js';
import {
  fetchDictionaryItems,
  useDictionaryItems,
} from '../../../../shared/dictionaries/queries.js';
import { useCreateCustomField, useUpdateCustomField } from '../../api/custom-fields-api.js';
import {
  commitOptionDrafts,
  invalidateDictionaries,
  useCreateDictionary,
} from '../../api/dictionaries-api.js';
import {
  createBody,
  draftIssues,
  draftOf,
  draftType,
  emptyDraft,
  isListFamily,
  listDefault,
  patchBody,
  scalarDefault,
  withFamily,
  type DraftIssue,
  type FieldDraft,
} from '../../lib/field-draft.js';
import { FieldDialogForm } from './field-dialog-form.js';
import { useDefaultCurrencyId } from './field-settings.js';
import { FieldTypePicker } from './field-type-picker.js';

export type FieldDialogMode =
  | { kind: 'create'; scope: CustomFieldScope; presetTypeId?: string }
  | { kind: 'edit'; definition: CustomFieldDefinition };

interface Errors {
  name?: string;
  options?: string;
  form?: string;
}

/**
 * Окно атрибута (#431, ревизия UI 25.10.2026 — вместо колонки-редактора с
 * автосохранением): ОДНО окно на создание и правку. Слева — колонка типов,
 * справа — форма выбранного типа; высота окна фиксирована (смена типа и
 * длинные списки вариантов не меняют габарит — канон оверлеев), прокрутка
 * внутри колонок. Всё правится в черновике и уходит на сервер по
 * «Создать»/«Сохранить» (составная операция: варианты справочника →
 * атрибут). Мимо-клик окно не закрывает (заполненное не теряем); без права
 * `custom_field.manage` — просмотр с «Закрыть».
 */
export function FieldDialog({
  mode,
  definitions,
  canManage,
  onClose,
  onSaved,
}: {
  mode: FieldDialogMode;
  definitions: readonly CustomFieldDefinition[];
  canManage: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const definition = mode.kind === 'edit' ? mode.definition : null;
  const scope = mode.kind === 'edit' ? mode.definition.scope : mode.scope;
  const code =
    definition?.dictionary && definition.settings.dictionaryId ? definition.dictionary.code : null;
  const items = useDictionaryItems(code);
  const currencyFallback = useDefaultCurrencyId();
  const createField = useCreateCustomField();
  const updateField = useUpdateCustomField();
  const createDictionary = useCreateDictionary();

  const [draft, setDraft] = useState<FieldDraft | null>(() =>
    definition
      ? code
        ? null
        : draftOf(definition, [])
      : mode.kind === 'create' && mode.presetTypeId
        ? { ...emptyDraft, typeIds: [mode.presetTypeId] }
        : emptyDraft,
  );
  const [initial, setInitial] = useState<FieldDraft | null>(draft);
  // Варианты справочника приходят запросом: черновик правки собирается,
  // когда они загружены (derive-render, без эффекта).
  if (draft === null && definition && items.data) {
    const ready = draftOf(definition, items.data);
    setDraft(ready);
    setInitial(ready);
  }
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);

  const readOnly = !canManage;
  // Списки живут справочниками: без `dictionary.manage` сервер откажет и в
  // создании, и в правке вариантов (#491). Сервер — истина (I8), здесь —
  // честный UX: тип недоступен, варианты только для чтения.
  const canManageDictionaries = useCanManageDictionaries();
  const keptIds = new Set(draft?.options.map((option) => option.id));
  const removedOptions = (items.data ?? []).filter((item) => !keptIds.has(item.id)).length;
  const shared =
    definition?.settings.dictionaryId !== undefined &&
    definitions.filter((d) => d.settings.dictionaryId === definition.settings.dictionaryId).length >
      1;
  const issues: DraftIssue[] = draft ? draftIssues(draft) : ['family'];
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(initial);
  const canSave = !readOnly && draft !== null && issues.length === 0 && !pending && dirty;

  function update(next: Partial<FieldDraft>) {
    setDraft((current) => (current ? { ...current, ...next } : current));
    if ('name' in next) setErrors((current) => ({ ...current, name: undefined }));
    if ('options' in next) setErrors((current) => ({ ...current, options: undefined }));
  }

  function nameTakenLocally(name: string): boolean {
    const key = name.trim().toLowerCase();
    return definitions.some(
      (entry) =>
        entry.scope === scope &&
        entry.id !== definition?.id &&
        entry.name.trim().toLowerCase() === key,
    );
  }

  async function save() {
    if (!draft || !canSave) return;
    if (!canManageDictionaries && isListFamily(draft.family)) {
      // Создание списка без права невозможно; правка существующего списка
      // допустима, только если варианты не менялись (иначе сервер откажет).
      const optionsChanged =
        JSON.stringify(draft.options) !== JSON.stringify(initial?.options ?? []);
      if (!definition || optionsChanged) {
        setErrors({ form: ui.customFields.dialog.dictionaryReadOnly });
        return;
      }
    }
    if (nameTakenLocally(draft.name)) {
      setErrors({ name: errorMessages[ErrorCode.CUSTOM_FIELD_NAME_TAKEN] });
      return;
    }
    const type = draftType(draft)!;
    setPending(true);
    setErrors({});
    try {
      if (!definition) {
        let dictionaryId: string | undefined;
        let defaultValue = scalarDefault(draft);
        if (isListFamily(draft.family)) {
          const dictionary = await createDictionary.mutateAsync({
            name: draft.name.trim(),
            items: draft.options.map((option) => option.name.trim()),
          });
          const created = await fetchDictionaryItems(dictionary.code);
          const ids = new Map(draft.options.map((option, i) => [option.id, created[i]?.id ?? '']));
          dictionaryId = dictionary.id;
          defaultValue = listDefault(draft, type, ids);
        }
        const body = createBody(
          type === 'money' && !draft.settings.currencyId
            ? { ...draft, settings: { currencyId: currencyFallback } }
            : draft,
          scope,
          { dictionaryId, defaultValue },
        );
        const saved = await createField.mutateAsync(body);
        onSaved(saved.id);
        return;
      }
      let defaultValue = scalarDefault(draft);
      if (code && isListFamily(draft.family)) {
        if (canManageDictionaries) {
          const ids = await commitOptionDrafts(code, items.data ?? [], draft.options);
          defaultValue = listDefault(draft, type, ids);
          invalidateDictionaries(queryClient);
        } else {
          // Без права варианты только для чтения: id уже серверные —
          // умолчание сохраняем, иначе PATCH молча сотрёт его (#491).
          defaultValue = listDefault(draft, type, new Map());
        }
      }
      const body = patchBody(definition, draft, defaultValue);
      if (body) await updateField.mutateAsync({ id: definition.id, body });
      onSaved(definition.id);
    } catch (caught) {
      const codeOf = caught instanceof ApiError ? caught.code : null;
      if (codeOf === ErrorCode.CUSTOM_FIELD_NAME_TAKEN) {
        setErrors({ name: errorMessages[ErrorCode.CUSTOM_FIELD_NAME_TAKEN] });
      } else if (codeOf === ErrorCode.DICTIONARY_ITEM_NAME_TAKEN) {
        setErrors({ options: errorMessages[ErrorCode.DICTIONARY_ITEM_NAME_TAKEN] });
      } else {
        setErrors({
          form:
            codeOf && codeOf in errorMessages
              ? errorMessages[codeOf as ErrorCode]
              : ui.customFields.dialog.saveError,
        });
      }
    } finally {
      setPending(false);
    }
  }

  const title = !definition
    ? ui.customFields.dialog.createTitle
    : readOnly
      ? ui.customFields.dialog.viewTitle
      : ui.customFields.dialog.editTitle;

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
        // Габарит — по содержимому с нижней границей «самая высокая обычная
        // форма»: обычные типы окно не меняет, у списка с вариантами оно
        // подрастает до 92vh, а не прокручивается (вердикт 25.10.2026).
        className="flex max-h-[92vh] min-h-[min(34rem,88vh)] max-w-[56rem] flex-col gap-5 overflow-hidden p-5 sm:max-w-[56rem]"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{definition ? `${title} · ${definition.name}` : title}</DialogTitle>
          <DialogDescription>{ui.customFields.dialog.scopeHint[scope]}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 gap-6">
          <aside className="flex w-52 shrink-0 flex-col">
            <FieldTypePicker
              value={draft?.family ?? null}
              locked={definition !== null}
              disabled={readOnly || pending}
              canManageDictionaries={canManageDictionaries}
              onChange={(family) =>
                setDraft((current) => {
                  const next = withFamily(current ?? emptyDraft, family);
                  return family === 'money' && !next.settings.currencyId
                    ? { ...next, settings: { currencyId: currencyFallback } }
                    : next;
                })
              }
            />
          </aside>
          {/* overflow-x-hidden: вертикальная прокрутка иначе включает
              горизонтальную полосу от долей пикселя (баг 25.10.2026). */}
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-1">
            <FieldDialogForm
              draft={draft}
              scope={scope}
              definition={definition}
              shared={shared}
              disabled={readOnly || pending}
              optionsReadOnly={!canManageDictionaries}
              errors={errors}
              issues={issues}
              currencyFallback={currencyFallback}
              removedOptions={removedOptions}
              onChange={update}
            />
          </div>
        </div>

        <DialogFooter className="shrink-0 items-center">
          {errors.form ? (
            <p role="alert" className="mr-auto text-xs text-danger">
              {errors.form}
            </p>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {readOnly ? ui.common.close : ui.common.cancel}
          </Button>
          {readOnly ? null : (
            <Button disabled={!canSave} onClick={() => void save()}>
              {pending
                ? ui.customFields.dialog.saving
                : definition
                  ? ui.customFields.dialog.save
                  : ui.customFields.dialog.create}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
