import type { ReactNode } from 'react';
import { ui } from '@nodus/contracts';

import type { BlockPatch, BuilderBlock, BuilderField, FieldPatch } from './builder-model.js';

/**
 * Хост редактора окна (#496): что за окно и какие у него поля. Редактор
 * общий (раскладка, оформление, замки), хост — своё: какие поля есть, как
 * выглядит контрол в превью и что ещё настраивается у поля (обязательность,
 * скрытое значение, формула, состояние слота).
 */

/** Вид контрола в превью окна (без ввода — только как будет выглядеть). */
export type PreviewKind = 'input' | 'text' | 'select' | 'people' | 'date' | 'number' | 'toggle';

export interface BuilderFieldInfo {
  /** Стандартная подпись поля (без своей). */
  label: string;
  preview: PreviewKind;
  /** Многострочное поле: настраивается высота. */
  multiline?: boolean;
  /** Поле удалено (атрибута больше нет) — только убрать. */
  unknown?: boolean;
  /** Строку не убрать (системные строки проекта). */
  fixed?: boolean;
  /** Можно закрепить (Р4). */
  lockable?: boolean;
  /** Поле добавило условие перехода, а не окно (только показ). */
  fromGate?: boolean;
  /** Строка без подписи (название окна создания). */
  hideLabel?: boolean;
  /** У строки нет подсказки (системные строки проекта). */
  hideHint?: boolean;
  /** В настройках нет подписи/подсказки/высоты — только своё хоста. */
  hideLayout?: boolean;
}

export interface BuilderOption {
  key: string;
  label: string;
  /** Откуда поле: системное поле сущности или созданный атрибут. В лотке
   *  и «+» они показаны отдельными группами — различие для настройщика
   *  (системное нельзя удалить из справочника, атрибут — можно), у
   *  сотрудника в окне форма одна (#496). */
  group?: 'system' | 'attribute';
}

/** Группы полей палитры по происхождению: системные, атрибуты, прочее.
 *  Подписи показываются, только когда категорий больше одной — один
 *  список без заголовка не шумит. */
export function fieldGroups(
  options: readonly BuilderOption[],
): readonly { label: string | null; options: readonly BuilderOption[] }[] {
  const b = ui.forms.builder;
  const groups = [
    { label: b.groupSystem, options: options.filter((option) => option.group === 'system') },
    { label: b.groupAttributes, options: options.filter((option) => option.group === 'attribute') },
    { label: null, options: options.filter((option) => option.group === undefined) },
  ].filter((group) => group.options.length > 0);
  return groups.length > 1 ? groups : groups.map((group) => ({ ...group, label: null }));
}

/** Блок окна в палитре: трудозатраты, итог, файлы, причина, чек-лист.
 *  `layout` — у блока есть своя подпись и подсказка (у чипов — нет). */
export interface BuilderBlockOption {
  block: string;
  label: string;
  preview: PreviewKind;
  layout?: boolean;
}

export interface FormBuilderHost<X> {
  /** Шапка редактора: «Окно создания · Комплект». */
  title: string;
  info: (key: string) => BuilderFieldInfo;
  /** Поля, которых нет в окне и которые можно добавить. */
  catalog: readonly BuilderOption[];
  makeField: (key: string) => BuilderField<X>;
  /** Блоки окна: доступные виды и создание элемента. */
  blocks?: readonly BuilderBlockOption[];
  makeBlock?: (block: string) => BuilderBlock<X>;
  /** Свои параметры блока (режим, обязательность, минимум файлов). */
  blockSettings?: (block: BuilderBlock<X>, patch: (patch: BlockPatch<X>) => void) => ReactNode;
  /** Настоящий вид блока в превью (то, что увидит сотрудник). */
  renderBlock?: (block: BuilderBlock<X>) => ReactNode;
  /** Право создавать атрибут: кнопка в лотке «Создать атрибут». */
  onCreateField?: () => void;
  /** Метки у подписи в превью: «скрыто», «по формуле». */
  badges?: (field: BuilderField<X>) => string[];
  /** Обязательное поле — звёздочка в превью. */
  required?: (field: BuilderField<X>) => boolean;
  /** Своё в настройках поля (обязательность, скрытое значение, формула). */
  settings?: (field: BuilderField<X>, patch: (patch: FieldPatch<X>) => void) => ReactNode;
  /** Замки окна: после создания / после нажатия; null — хост без замков. */
  lockMode: 'creation' | 'transition' | null;
  /** «Закрепить также» — поля вне окна, которые можно закрепить. */
  lockable?: readonly BuilderOption[];
  /** Неподвижные строки над полями (название, тип). */
  fixedTop?: ReactNode;
  /** Разделы окна под полями (время, итог, файлы, причина). */
  footer?: ReactNode;
  limits: { fields: number; decor: number };
}
