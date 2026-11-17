import type { Permission } from '@nodus/contracts';
import type { z } from 'zod';

/**
 * Определение инструмента ИИ-агента (ADR-0043 п. 2–5): описание операции API
 * портала, а не кода доступа к данным. Инструмент исполняется от имени
 * сотрудника (`Authorization`), поэтому права, валидация и аудит API
 * переиспользуются целиком.
 *
 * Read-only предохранитель: `kind: write` в Ф1 не регистрируется и не
 * исполняется — проверка в каталоге и в исполнителе, а не в промпте.
 */

/** Домен каталога: префикс имени инструмента (`tasks.list`). */
export const ASSISTANT_TOOL_MODULES = [
  'tasks',
  'projects',
  'letters',
  'chat',
  'directory',
  'dictionaries',
  'workflows',
  'system',
  /** Вложения: чтение текста PDF/DOCX (#922). */
  'files',
  /** Внешние серверы MCP (`ext.exa.web_search_exa`, Ф3/#901). */
  'ext',
] as const;
export type AssistantToolModule = (typeof ASSISTANT_TOOL_MODULES)[number];

/** Режим инструмента: чтение или запись (Ф2, ADR-0048). Запись НЕ
 *  исполняется из цикла напрямую — она готовит карточку подтверждения
 *  (`card`), а запись в портал делает только сотрудник (или байпас). */
export type ToolKind = 'read' | 'write';

/** Контекст экрана, проверенный на допустимые значения (client → server). */
export interface ScreenContext {
  moduleId: string | null;
  cardKind: 'task' | 'project' | 'letter' | 'conversation' | null;
  cardId: string | null;
}

/** Ссылка «Открыть» для карточки сущности в интерфейсе. */
export interface ToolEntity {
  /** Относительный адрес портала: `?cards=task:<id>` (внутренний, не внешний). */
  href: string;
  label: string;
}

/** Компактный результат инструмента: текст для модели + сущность для UI. */
export interface ToolResult {
  /** Проекция для промпта: строки, а не сырой JSON. */
  text: string;
  entity?: ToolEntity;
}

/** Окружение вызова: токен сотрудника живёт только в памяти прогона. */
export interface ToolContext {
  /** `Bearer …` текущего сотрудника — тот же конвейер, что у интерфейса. */
  authorization: string;
  screen: ScreenContext;
  /** Отмена прогона: «Стоп» обязан оборвать и уже запущенные инструменты. */
  signal: AbortSignal;
  /** Разрешённые инструменты (для `tools.search`: искать только доступные). */
  available: readonly AssistantToolDefinition[];
  /** `tools.search` добавляет инструменты в активный набор следующего шага. */
  activate: (toolIds: readonly string[]) => void;
  /**
   * GET API портала от имени сотрудника — для подготовки карточки действия
   * (имена вместо id: «исполнитель Иванов», а не uuid). Ошибки — исключением;
   * карточка обязана собраться и без ответа (id показывается как есть).
   */
  read?: (path: string) => Promise<unknown>;
  /** Личный блокнот агента (#900): порт прогона (владелец + прогон известны). */
  memory?: {
    save: (text: string) => Promise<{ id: string; text: string; duplicate: boolean }>;
    list: () => Promise<{ id: string; text: string }[]>;
    forget: (id: string) => Promise<boolean>;
  };
}

/** Операция API, которую описывает инструмент — для проверки по OpenAPI. */
export interface ToolApiOperation {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Шаблон пути без глобального префикса: `/tasks/:id`, `/dictionaries/:code/items`. */
  path: string;
}

/** Запрос исполнения: метод, путь с подставленными параметрами + query/body. */
export interface ToolRequest {
  /** По умолчанию — метод из `api` (у чтения GET). */
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string>;
  /** JSON-тело мутации; отсутствует у GET. */
  body?: unknown;
}

/** Поле карточки подтверждения (человеческие подпись и значение). */
export interface ToolActionField {
  label: string;
  value: string;
}

/**
 * Описание карточки подтверждения (Ф2, ADR-0048): «что будет сделано».
 * Собирается ДО записи в портал; сотрудник проверяет поля и жмёт
 * «Выполнить». Функции могут дочитать имена по id (ctx.read) — карточка
 * показывает «Иванов Иван», а не uuid.
 */
export interface ToolWriteCard {
  /** Заголовок карточки: «Создать задачу». */
  title: string;
  /** Одна фраза о действии. */
  summary: (input: Record<string, unknown>, ctx: ToolContext) => string | Promise<string>;
  /** Ключевые поля столбиком. */
  fields: (
    input: Record<string, unknown>,
    ctx: ToolContext,
  ) => ToolActionField[] | Promise<ToolActionField[]>;
  /** Последствия для сотрудника (куда попадёт запись, необратимость). */
  consequences: string;
  /** Запрос отмены выполненного: созданное удаляется. Нет функции — карточка
   *  честно говорит, что отмена невозможна. */
  undo?: (input: Record<string, unknown>, output: unknown) => ToolRequest | null;
}

/** Определение инструмента (одно на операцию API). */
export interface AssistantToolDefinition {
  /** `module.action`: `tasks.list`. Внешние (Ф3) — `ext.<server>.<tool>`. */
  id: string;
  /** Человеческое название для карточки в ленте: «Задачи: список». */
  title: string;
  /** Описание для модели: когда вызывать и что вернёт. */
  description: string;
  /** Ключевые слова лексического поиска (`tools.search`). */
  keywords: readonly string[];
  module: AssistantToolModule;
  kind: ToolKind;
  /** Дополнительное право сверх `assistant.use` (например `directory.read`). */
  permission?: Permission;
  /** Флаг модуля-владельца: без него инструмент не попадает в каталог (I10). */
  featureFlag?: string;
  /** Горячая полка: инструмент всегда в промпте (ADR-0043 п. 4). */
  hot: boolean;
  /** zod-схема аргументов: валидируется до вызова API. */
  input: z.ZodType;
  /** Операция API; `null` у вычислимых инструментов (контекст, поиск, ссылка). */
  api?: ToolApiOperation;
  /** Построение запроса из аргументов. */
  build?: (input: Record<string, unknown>) => ToolRequest;
  /**
   * Второй шаг записи после успешного первого (например, «создать личный
   * чат → отправить сообщение»). Выполняется ТОЛЬКО внутри `executeWrite`
   * (карточка/байпас) с отдельным суффиксом идемпотентности; из цикла записи
   * по-прежнему нет.
   */
  followUp?: (data: unknown, input: Record<string, unknown>) => ToolRequest | null;
  /** Проекция ответа API в компактный текст. `steps` — ответы всех шагов
   *  записи (первый — созданная сущность, последний — итоговая). */
  project?: (
    data: unknown,
    input: Record<string, unknown>,
    steps?: readonly unknown[],
  ) => ToolResult;
  /** Карточка подтверждения — обязательна для `kind: write` (фьюз каталога). */
  card?: ToolWriteCard;
  /** Вычислимые инструменты без API-вызова. */
  handler?: (input: Record<string, unknown>, ctx: ToolContext) => ToolResult | Promise<ToolResult>;
}

/**
 * Хелпер определения с сохранением типа аргументов: zod-схема даёт тип
 * `build`/`project`, а каталог хранит однородный массив. Приведение
 * безопасно: аргументы уже проверены `input.safeParse` в исполнителе —
 * типы внутри функции совпадают со схемой (единственный каст на весь модуль).
 */
export function defineTool<S extends z.ZodType, TData = unknown>(definition: {
  id: string;
  title: string;
  description: string;
  keywords: readonly string[];
  module: AssistantToolModule;
  kind: ToolKind;
  permission?: Permission;
  featureFlag?: string;
  hot: boolean;
  input: S;
  api?: ToolApiOperation;
  build?: (input: z.infer<S>) => ToolRequest;
  followUp?: (data: unknown, input: z.infer<S>) => ToolRequest | null;
  /**
   * Проекция ответа. TData — тип ответа API из `@nodus/contracts` (например
   * `Paginated<TaskListItem>`): переименование поля DTO ломает компиляцию
   * проекции, а не тихо отдаёт «—» модели (#918, ADR-0049). Данные с границы
   * всё равно проверяются охранником (`asTyped`), мусор не роняет прогон.
   */
  project?: (data: TData, input: z.infer<S>, steps?: readonly unknown[]) => ToolResult;
  card?: {
    title: string;
    summary: (input: z.infer<S>, ctx: ToolContext) => string | Promise<string>;
    fields: (input: z.infer<S>, ctx: ToolContext) => ToolActionField[] | Promise<ToolActionField[]>;
    consequences: string;
    undo?: (input: z.infer<S>, output: unknown) => ToolRequest | null;
  };
  handler?: (input: z.infer<S>, ctx: ToolContext) => ToolResult | Promise<ToolResult>;
}): AssistantToolDefinition {
  return definition as unknown as AssistantToolDefinition;
}
