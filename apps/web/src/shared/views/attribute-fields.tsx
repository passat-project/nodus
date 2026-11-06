import type {
  CustomFieldDefinition,
  CustomFieldModule,
  CustomFieldRef,
  CustomFieldType,
  CustomFieldValue,
  CustomFieldValues,
} from '@nodus/contracts';
import { bindingsOf, customFieldKey } from '@nodus/contracts';

import { CustomFieldValueView, refsById } from '../custom-fields/value-view.js';
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

/** Значение атрибута у сущности (задача, папка, проект) — по id определения. */
export function attributeValue(
  entity: { customFields?: CustomFieldValues },
  definition: Pick<CustomFieldDefinition, 'id'>,
): CustomFieldValue | undefined {
  return entity.customFields?.[definition.id];
}

/** Ссылки сущности по id: имена/аватары/цвета значений-ссылок (Р6 #631). */
export function attributeRefs(entity: {
  customFieldRefs?: readonly CustomFieldRef[];
}): ReadonlyMap<string, CustomFieldRef> {
  return refsById(entity.customFieldRefs ?? []);
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
  interactive = true,
) {
  const fromValueControl = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest('button,a') !== null;
  return (
    <span
      className="flex min-w-0 max-w-full items-center"
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
      <CustomFieldValueView
        definition={definition}
        value={value}
        refs={refs}
        compact
        interactive={interactive}
      />
    </span>
  );
}
