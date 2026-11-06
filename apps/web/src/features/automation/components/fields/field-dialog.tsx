import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CustomFieldDefinition } from '@nodus/contracts';
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
import {
  useCreateCustomField,
  useSetCompanyValue,
  useUpdateCustomField,
} from '../../api/custom-fields-api.js';
import {
  commitOptionDrafts,
  invalidateDictionaries,
  updateDictionaryItem,
  useCreateDictionary,
} from '../../api/dictionaries-api.js';
import {
  companyValueChanged,
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
import { suggestionOf, type Errors } from './field-dialog-errors.js';
import { useDefaultCurrencyId } from './field-settings.js';
import { FieldTypePicker } from './field-type-picker.js';

export type FieldDialogMode =
  { kind: 'create' } | { kind: 'edit'; definition: CustomFieldDefinition };

/**
 * Окно атрибута (#431, ревизия #631): ОДНО окно на создание и правку
 * атрибута портала. Слева — колонка типов, справа — форма выбранного типа
 * («Основное», «Вид использования» и «Где используется», настройки,
 * варианты, умолчание); высота окна фиксирована, прокрутка внутри колонок.
 * Всё правится в черновике и уходит на сервер по «Создать»/«Сохранить»
 * (составная операция: варианты справочника → атрибут → значение
 * глобальной). Мимо-клик окно не закрывает (заполненное не теряем); без
 * права `custom_field.manage` — просмотр с «Закрыть». Дубль имени —
 * предложение открыть существующий (В3: названия уникальны на портале).
 */
export function FieldDialog({
  mode,
  definitions,
  canManage,
  onClose,
  onSaved,
  onOpenDefinition,
}: {
  mode: FieldDialogMode;
  definitions: readonly CustomFieldDefinition[];
  canManage: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
  /** Переход к существующему атрибуту по кнопке предложения (В3). */
  onOpenDefinition: (definitionId: string) => void;
}) {
  const queryClient = useQueryClient();
  const definition = mode.kind === 'edit' ? mode.definition : null;
  const code =
    definition?.dictionary && definition.settings.dictionaryId ? definition.dictionary.code : null;
  const items = useDictionaryItems(code);
  const currencyFallback = useDefaultCurrencyId();
  const createField = useCreateCustomField();
  const updateField = useUpdateCustomField();
  const setCompanyValue = useSetCompanyValue();
  const createDictionary = useCreateDictionary();

  const [draft, setDraft] = useState<FieldDraft | null>(() =>
    definition ? (code ? null : draftOf(definition, [])) : emptyDraft,
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
  const [suggestion, setSuggestion] = useState<{ definitionId: string; name: string } | null>(null);
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
    if ('name' in next) {
      setErrors((current) => ({ ...current, name: undefined }));
      setSuggestion(null);
    }
    if ('options' in next) setErrors((current) => ({ ...current, options: undefined }));
  }

  function nameTakenLocally(name: string): CustomFieldDefinition | undefined {
    const key = name.trim().toLowerCase();
    return definitions.find(
      (entry) => entry.id !== definition?.id && entry.name.trim().toLowerCase() === key,
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
    const existing = nameTakenLocally(draft.name);
    if (existing) {
      setErrors({ name: errorMessages[ErrorCode.CUSTOM_FIELD_NAME_TAKEN] });
      setSuggestion({ definitionId: existing.id, name: existing.name });
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
          // Цвета новых вариантов: POST справочника принимает только имена.
          for (const [index, option] of draft.options.entries()) {
            const item = created[index];
            if (item && option.color) {
              await updateDictionaryItem(dictionary.code, item.id, { color: option.color });
            }
          }
          dictionaryId = dictionary.id;
          defaultValue = listDefault(draft, type, ids);
        }
        const body = createBody(
          type === 'money' && !draft.settings.currencyId
            ? { ...draft, settings: { currencyId: currencyFallback } }
            : draft,
          { dictionaryId, defaultValue },
        );
        const saved = await createField.mutateAsync(body);
        if (draft.isCompany && draft.companyValue !== null) {
          await setCompanyValue.mutateAsync({
            fieldId: saved.id,
            value: draft.companyValue,
          });
        }
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
      if (definition.isCompany && companyValueChanged(definition, draft)) {
        await setCompanyValue.mutateAsync({ fieldId: definition.id, value: draft.companyValue });
      }
      onSaved(definition.id);
    } catch (caught) {
      const codeOf = caught instanceof ApiError ? caught.code : null;
      if (codeOf === ErrorCode.CUSTOM_FIELD_NAME_TAKEN) {
        setErrors({ name: errorMessages[ErrorCode.CUSTOM_FIELD_NAME_TAKEN] });
        setSuggestion(suggestionOf(caught));
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
        // Габарит — по содержимому: у списка с вариантами окно растёт до 92vh.
        className="flex max-h-[92vh] min-h-[min(34rem,88vh)] max-w-[56rem] flex-col gap-5 overflow-hidden p-5 sm:max-w-[56rem]"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{definition ? `${title} · ${definition.name}` : title}</DialogTitle>
          <DialogDescription>{ui.customFields.dialog.portalHint}</DialogDescription>
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
            {items.isError ? (
              <div className="flex flex-col gap-2 p-4 text-sm">
                <span className="text-muted-foreground">
                  {ui.customFields.dialog.dictionaryLoadError}
                </span>
                <button
                  type="button"
                  onClick={() => void items.refetch()}
                  className="w-fit text-xs font-medium text-info underline-offset-2 hover:underline"
                >
                  {ui.customFields.block.retry}
                </button>
              </div>
            ) : (
              <FieldDialogForm
                draft={draft}
                definition={definition}
                shared={shared}
                disabled={readOnly || pending}
                optionsReadOnly={!canManageDictionaries}
                errors={errors}
                issues={issues}
                currencyFallback={currencyFallback}
                removedOptions={removedOptions}
                suggestion={suggestion}
                onOpenSuggestion={onOpenDefinition}
                onChange={update}
              />
            )}
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
