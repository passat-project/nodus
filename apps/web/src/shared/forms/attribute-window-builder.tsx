import { useMemo, type ReactNode } from 'react';
import type { CustomFieldDefinition, FormulaHostKind } from '@nodus/contracts';

import {
  attributeFromBuilder,
  attributeToBuilder,
  type AttributeElement,
} from './attribute-form-model.js';
import { useAttributeHost, type AttributeSystemInfo } from './attribute-form-host.js';
import { FormBuilder } from './builder/form-builder.js';

/**
 * Редактор формы атрибутов ПОВЕРХ экрана — оболочка-окно над телом
 * `FormBuilderBody` (#496, единое ядро): черновик живёт до «Готово», пустой
 * заголовок/пояснение не уйдёт хосту (`blockEmptyDecor`). Окном редактор
 * остаётся только там, где он — логика ноды: строка реестра (#857, единая
 * модель «Процессов»). Формы создания вида папки и типа проекта настраиваются
 * тем же телом (`useAttributeHost`) во вкладке «Форма создания» с
 * автосохранением. Хост — `useAttributeHost`.
 */
export function AttributeWindowBuilder({
  open,
  title,
  elements,
  definitions,
  systemInfo,
  formulaHostKind,
  fixedTop,
  readOnly,
  error,
  onCreateField,
  onDone,
  onClose,
}: {
  open: boolean;
  title: string;
  elements: readonly AttributeElement[];
  /** Атрибуты, доступные в палитре (привязанные к месту). */
  definitions: readonly CustomFieldDefinition[];
  /** Системные строки: подписи и виды контролов. */
  systemInfo?: (key: string) => AttributeSystemInfo;
  formulaHostKind: FormulaHostKind;
  fixedTop?: ReactNode;
  readOnly: boolean;
  /** Ошибка сохранения — показывается под окном, редактор не закрывается. */
  error?: string | null;
  onCreateField?: () => void;
  onDone: (elements: AttributeElement[]) => void;
  onClose: () => void;
}) {
  const value = useMemo(() => attributeToBuilder(elements), [elements]);
  const host = useAttributeHost(
    title,
    definitions,
    systemInfo,
    formulaHostKind,
    fixedTop,
    readOnly,
    error,
    onCreateField,
  );
  return (
    <FormBuilder
      open={open}
      host={host}
      value={value}
      readOnly={readOnly}
      blockEmptyDecor
      onCancel={onClose}
      onDone={(next) => onDone(attributeFromBuilder(next))}
    />
  );
}
