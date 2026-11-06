import type { InjectionToken } from '@nestjs/common';

/**
 * Порт целей привязки атрибутов в проектах (Р3 #631): модуль custom-fields
 * валидирует привязки «Где используется» к типам проектов и видам папок,
 * не читая чужие таблицы (I3). Готового наружного ридера этих справочников
 * не было — разведка Ф1 техплана #631; каталог вывозит оба списка сразу.
 */
export const FIELD_BINDING_TARGET_READER: InjectionToken = 'FIELD_BINDING_TARGET_READER';

export interface FieldBindingTarget {
  id: string;
  name: string;
  /** Архивный вид допустим в привязке: формы архивных видов живут. */
  archived: boolean;
}

export interface FieldBindingTargetReader {
  /** Типы проектов (включая архивные — архива у типов нет, поле задел). */
  projectTypes(): Promise<FieldBindingTarget[]>;

  /** Виды папок (архивные включаются: их формы живут у существующих папок). */
  nodeKinds(): Promise<FieldBindingTarget[]>;
}
