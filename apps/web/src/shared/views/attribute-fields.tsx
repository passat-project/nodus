import { CircleAlert } from 'lucide-react';
import type {
  CustomFieldDefinition,
  CustomFieldFormulaInfo,
  CustomFieldModule,
  CustomFieldRef,
  CustomFieldType,
  CustomFieldValue,
} from '@nodus/contracts';
import { bindingsOf, customFieldKey, isCustomFieldValueFilled, ui } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import type { AttributeCarrier } from '../custom-fields/attribute-carrier.js';
import { cleanFormulaText } from '../custom-fields/formula/formula-preview.js';
import { CustomFieldValueView, refsById } from '../custom-fields/value-view.js';
import type { DataTableField } from './data-table.js';
import type { FieldDef } from './use-view-fields.js';

/**
 * Атрибутные колонки и блоки видов (#632, В3/В5): атрибут реестра (#631)
 * становится полем представления там, где он привязан. Одна грамматика для
 * плоских списков, канбана и дерева структуры: id поля — `cf.<fieldId>`
 * (адрес атрибута в формулах и API), значение — из `customFields` сущности,
 * имена ссылок — из её `customFieldRefs`.
 *
 * Атрибуты скрыты по умолчанию: список вида не раздувается от реестра
 * портала (атрибутов до 1000), включение — шестерёнкой в группе «Атрибуты».
 * Ячейка показывает формульное состояние (`customFieldFormulas`): значок
 * «fx» и бейдж ошибки — колонка не врёт о том, откуда значение.
 */

/** Префикс id атрибутного поля (`cf.<uuid>` — как в окнах и формулах). */
export const ATTRIBUTE_FIELD_PREFIX = 'cf.';

/** Ширина колонки по типу атрибута, дизайн-px: цифры узкие, ссылки и
 *  многострочный текст — шире (по ним же считается гридд-трек таблицы). */
const ATTRIBUTE_WIDTHS: Record<CustomFieldType, number> = {
  text: 160,
  long_text: 200,
  number: 110,
  money: 110,
  duration: 110,
  date: 140,
  datetime: 140,
  bool: 90,
  enum: 140,
  multienum: 140,
  user: 160,
  users: 160,
  department: 150,
  project: 150,
  counterparty: 150,
  task: 160,
  letter: 160,
  node: 160,
  link: 180,
};

/** Место показа атрибута в видах (модуль без «Глобальных переменных»:
 *  переменная значений записей не принимает и в колонки не идёт). */
export type AttributeModule = Exclude<CustomFieldModule, 'company'>;

/** id атрибутного поля представления — `cf.<fieldId>`. */
export function attributeFieldId(definition: Pick<CustomFieldDefinition, 'id'>): string {
  return customFieldKey(definition.id);
}

/** Поле вида — атрибутное (`cf.…`), а не системное поле модуля. */
export function isAttributeFieldId(fieldId: string): boolean {
  return fieldId.startsWith(ATTRIBUTE_FIELD_PREFIX);
}

/**
 * Привязан ли атрибут к месту показа этой категории вида:
 * — задачи и письма — категория типа процесса (`processCategories`, сервер
 *   считает по привязкам: один и тот же тип-категория не путает задачу с
 *   письмом);
 * — папки — вид папки, проекты — тип проекта (привязки напрямую).
 * Старый API `processCategories` не присылает — тогда решает наличие
 * привязок к типам процессов (список уже отфильтрован сервером по модулю).
 */
export function attributeFitsModule(
  definition: CustomFieldDefinition,
  module: AttributeModule,
): boolean {
  if (definition.isCompany) return false;
  const bindings = bindingsOf(definition);
  switch (module) {
    case 'task':
      return definition.processCategories
        ? definition.processCategories.includes('task')
        : bindings.processTypeIds.length > 0;
    case 'letter':
      return definition.processCategories
        ? definition.processCategories.includes('letter')
        : bindings.processTypeIds.length > 0;
    case 'project':
      return bindings.projectTypeIds.length > 0;
    case 'node':
      return bindings.nodeKindIds.length > 0;
  }
}

/**
 * Поля вида из атрибутов места: фильтр по привязкам, id `cf.<fieldId>`,
 * скрыты по умолчанию, ширина по типу. Порядок — реестра (sortOrder
 * приходит с сервера).
 */
export function attributeFieldDefs({
  definitions,
  module,
}: {
  definitions?: readonly CustomFieldDefinition[];
  module: AttributeModule;
}): FieldDef[] {
  return (definitions ?? [])
    .filter((definition) => attributeFitsModule(definition, module))
    .map((definition) => ({
      id: attributeFieldId(definition),
      label: definition.name,
      defaultVisible: false,
      defaultWidth: ATTRIBUTE_WIDTHS[definition.type],
      group: 'attributes' as const,
      attribute: definition,
      locked: false,
    }));
}

/**
 * Колонки-атрибуты для реестра таблицы вида (#632, Р9): поля из
 * `attributeFieldDefs` + рендер ячейки по грамматике типа с формульными
 * пометками (fx/«!»). Одна фабрика на все реестры (задачи, письма,
 * проекты) — «модули не отличаются»: семантика ячейки не расходится.
 *
 * Пустое значение без ошибки формулы — пустая ячейка: список не пестрит
 * «Не задано», колонку включают осознанно. Сортировки нет (`sortValue` не
 * задан) — хедер рисует заголовок без ↑/↓, серверная сортировка в #435.
 */
export function attributeColumnFields<T extends object>({
  definitions,
  module,
}: {
  definitions?: readonly CustomFieldDefinition[];
  module: AttributeModule;
}): DataTableField<T>[] {
  return attributeFieldDefs({ definitions, module }).map((field) => ({
    ...field,
    render: (row: T) => {
      const definition = field.attribute;
      if (!definition) return null;
      const value = attributeValue(row, definition);
      const formula = attributeFormula(row, definition);
      if (!isCustomFieldValueFilled(value) && !formula?.error) return null;
      return attributeRenderCell(definition, value, attributeRefs(row), { formula });
    },
  }));
}

/** Значение атрибута у сущности (задача, папка, проект, письмо) — по id
 *  определения. Сущность может не нести `customFields` (письма/проекты до
 *  расширения DTO списков — `AttributeCarrier`): тогда значения нет. */
export function attributeValue(
  entity: object,
  definition: Pick<CustomFieldDefinition, 'id'>,
): CustomFieldValue | undefined {
  return (entity as AttributeCarrier).customFields?.[definition.id];
}

/** Ссылки сущности по id: имена/аватары/цвета значений-ссылок (Р6 #631). */
export function attributeRefs(entity: object): ReadonlyMap<string, CustomFieldRef> {
  return refsById((entity as AttributeCarrier).customFieldRefs ?? []);
}

/** Формульное состояние ячейки сущности (#632): своя/типовая формула или
 *  значение, подавившее формулу типа, и ошибка вычисления. Приезжает в DTO
 *  (`customFieldFormulas`); нет записи — ячейка не формульная. */
export function attributeFormula(
  entity: object,
  definition: Pick<CustomFieldDefinition, 'id'>,
): CustomFieldFormulaInfo | undefined {
  return (entity as AttributeCarrier).customFieldFormulas?.[definition.id];
}

/** Значок формулы и бейдж ошибки в ячейке вида (#632, §4c): та же
 *  грамматика, что у `FormulaCell` в карточке — «fx» слева от значения
 *  (тихая у формулы типа, info у своей) и красный «!» с подсказкой. В
 *  строке таблицы это пометки, а не кнопки: правка формулы живёт в карточке,
 *  клик по строке открывает её (вложенный интерактив сломал бы строку). */
function AttributeFormulaMarks({ info }: { info: CustomFieldFormulaInfo }) {
  const own = info.origin === 'own';
  return (
    <>
      {own || info.origin === 'type' ? (
        <span
          title={own ? ui.formulas.cell.own : ui.formulas.cell.type}
          aria-label={ui.formulas.cell.fx}
          className={cn(
            '-ml-0.5 flex h-5 shrink-0 items-center font-mono text-label-xs font-medium',
            own ? 'text-info/70' : 'text-muted-foreground/70',
          )}
        >
          fx
        </span>
      ) : null}
      {info.error ? (
        <span
          title={`${ui.formulas.cell.error}: ${ui.formulas.errors[info.error.code]}`}
          aria-label={ui.formulas.cell.error}
          className="flex size-4 shrink-0 items-center justify-center rounded-full bg-danger/10 text-danger"
        >
          <CircleAlert className="size-3" strokeWidth={2.25} />
        </span>
      ) : null}
    </>
  );
}

/** Настройки ячейки атрибута в видах. */
export interface AttributeCellOptions {
  /** false — ячейка внутри триггера-кнопки (карточка канбана): ссылка
   *  значения не должна быть интерактивной (React DOM nesting). */
  interactive?: boolean;
  /** Формульное состояние ячейки (`attributeFormula`) — fx и бейдж «!». */
  formula?: CustomFieldFormulaInfo | null;
}

/**
 * Ячейка/блок значения атрибута — общий вид значения карточки в компактной
 * форме. `interactive=false` — внутри триггера-кнопки (карточка канбана):
 * кнопка в кнопке и ссылка в кнопке запрещены (React DOM nesting).
 *
 * Обёртка глушит всплытие клика/Enter по ССЫЛКЕ значения: строка списка и
 * строка дерева сами открывают запись по клику — иначе клик по имени
 * сотрудника открывал бы две карточки сразу. Клик мимо ссылки всплывает:
 * строка открывается как обычно.
 */
export function attributeRenderCell(
  definition: CustomFieldDefinition,
  value: CustomFieldValue | undefined,
  refs: ReadonlyMap<string, CustomFieldRef>,
  options: AttributeCellOptions = {},
) {
  const interactive = options.interactive ?? true;
  const fromValueControl = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest('button,a') !== null;
  return (
    <span
      className="flex min-w-0 max-w-full items-center gap-1"
      onClick={
        interactive
          ? (event) => {
              if (fromValueControl(event.target)) event.stopPropagation();
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (event) => {
              if (fromValueControl(event.target)) event.stopPropagation();
            }
          : undefined
      }
    >
      {options.formula ? <AttributeFormulaMarks info={options.formula} /> : null}
      <CustomFieldValueView
        definition={definition}
        value={options.formula ? (cleanFormulaText(value) ?? undefined) : value}
        refs={refs}
        compact
        interactive={interactive}
      />
    </span>
  );
}
