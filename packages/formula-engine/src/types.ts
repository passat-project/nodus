import type {
  CustomFieldType,
  FormulaAggregateFrom,
  FormulaErrorCode,
  FormulaSource,
  FormulaValueType,
  MoneyValue,
} from '@nodus/contracts';

/** Значение, которое видит формула: скаляр, деньги, список id или пусто.
 *  Дата/время — ISO-строка (статический тип различает date/datetime). */
export type FormulaValue = number | string | boolean | MoneyValue | string[] | null;

/** Запись-источник значений (задача, письмо, папка, проект, компания). */
export interface FormulaRecord {
  /** Значение атрибута по внутреннему номеру; null/undefined — пусто. */
  value(number: number): FormulaValue | undefined;
}

/** Источники одного значения (многозначные — только в агрегатах). */
export type FormulaSingleSource = Extract<
  FormulaSource,
  { kind: 'self' | 'parent_task' | 'folder_nearest' | 'project' | 'company' | 'ref_field' }
>;

/**
 * Резолвер — единственная точка чтения данных формулы. Реализации живут
 * там, где живут данные (порты владельцев, Р7): резолвер обязан вернуть
 * `null` для недоступного источника и отфильтровать выборку агрегата
 * (чужой проект, конфиденциальные и мягко удалённые записи) — движок не
 * умеет читать мимо резолвера.
 */
export interface FormulaResolver {
  /** Запись одного значения; null — источник недоступен по правилам Р7. */
  single(source: FormulaSingleSource): FormulaRecord | null;
  /** Выборка агрегата в порядке «последняя — в конце». */
  select(from: FormulaAggregateFrom): readonly FormulaRecord[];
}

/** Ошибка ячейки (runtime): ячейка показывает пусто и бейдж, работа идёт. */
export interface FormulaCellError {
  code: FormulaErrorCode;
  message: string;
  /** Номер атрибута-виновника (подсветка плашки редактора). */
  number?: number;
}

export interface FormulaEvaluation {
  value: FormulaValue;
  error: FormulaCellError | null;
}

/** Метаданные атрибута для статического тайпинга (реестр number → тип). */
export interface FormulaFieldMeta {
  number: number;
  type: CustomFieldType;
  /** Справочник списка — для динамической проверки УНИКАЛЬНЫХ. */
  dictionaryId?: string | null;
}

export interface FormulaRegistryMeta {
  byNumber: ReadonlyMap<number, FormulaFieldMeta>;
}

/** Проблема статической проверки типа (до вычисления). */
export interface FormulaTypeIssue {
  code:
    'type_mismatch' | 'arity' | 'attribute_deleted' | 'attribute_unavailable' | 'source_forbidden';
  path: string;
  message: string;
  number?: number;
}

export interface FormulaTypeResult {
  /** null — тип не выводится (неизвестный атрибут/ошибка). */
  type: FormulaValueType | null;
  issues: FormulaTypeIssue[];
}

/** Итог проверки формулы перед сохранением: блокирующие проблемы дают 422,
 *  неблокирующие (`attribute_deleted`) — только ошибку ячейки. */
export interface FormulaValidationIssue {
  code:
    | 'ast_invalid'
    | 'depth'
    | 'nodes'
    | 'sources'
    | 'literal_text'
    | 'arity'
    | 'source_forbidden'
    | 'selector_forbidden'
    | 'aggregate_field'
    | 'type_default_forbidden'
    | 'type_mismatch'
    | 'attribute_deleted'
    | 'attribute_unavailable';
  path: string;
  message: string;
  number?: number;
  /** true — сохранение отклоняется; false — формула сохраняется, ячейка
   *  показывает ошибку (работа не блокируется, Р13). */
  blocking: boolean;
}

export interface FormulaValidationResult {
  /** Нет блокирующих проблем. */
  ok: boolean;
  issues: FormulaValidationIssue[];
  /** Выведенный тип результата (null — неизвестен). */
  type: FormulaValueType | null;
}

/** Описание зависимости ячейки от данных портала (Р4): API превращает его
 *  в ключи `formula_deps.dep_key` (`v:<kind>:<uuid>:<number>`, `company:…`,
 *  `tree:…`, `rel:…`, `nodetasks:…`) в контексте конкретного хоста. */
export interface FormulaDependency {
  kind: 'value' | 'company' | 'parent' | 'project' | 'ref' | 'folder' | 'related' | 'node_tasks';
  number?: number;
  /** Номер атрибута-ссылки (для `ref`). */
  refField?: number;
  /** Вид папки (для `folder`/`folder_chain`). */
  kindId?: string;
  selector?: 'subtasks' | 'relations' | 'node_tasks';
}
