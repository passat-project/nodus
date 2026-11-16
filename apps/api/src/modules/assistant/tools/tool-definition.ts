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
] as const;
export type AssistantToolModule = (typeof ASSISTANT_TOOL_MODULES)[number];

/** Режим каталога: в Ф1 — только чтение (запись появится в Ф2, ADR-0043 п. 5). */
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
  /** Разрешённые инструменты (для `tools.search`: искать только доступные). */
  available: readonly AssistantToolDefinition[];
  /** `tools.search` добавляет инструменты в активный набор следующего шага. */
  activate: (toolIds: readonly string[]) => void;
}

/** Операция API, которую описывает инструмент — для проверки по OpenAPI. */
export interface ToolApiOperation {
  method: 'GET';
  /** Шаблон пути без глобального префикса: `/tasks/:id`, `/dictionaries/:code/items`. */
  path: string;
}

/** Запрос исполнения: путь с подставленными параметрами + query. */
export interface ToolRequest {
  path: string;
  query?: Record<string, string>;
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
  /** Проекция ответа API в компактный текст. */
  project?: (data: unknown, input: Record<string, unknown>) => ToolResult;
  /** Вычислимые инструменты без API-вызова. */
  handler?: (input: Record<string, unknown>, ctx: ToolContext) => ToolResult | Promise<ToolResult>;
}

/**
 * Хелпер определения с сохранением типа аргументов: zod-схема даёт тип
 * `build`/`project`, а каталог хранит однородный массив. Приведение
 * безопасно: аргументы уже проверены `input.safeParse` в исполнителе —
 * типы внутри функции совпадают со схемой (единственный каст на весь модуль).
 */
export function defineTool<S extends z.ZodType>(definition: {
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
  project?: (data: unknown, input: z.infer<S>) => ToolResult;
  handler?: (input: z.infer<S>, ctx: ToolContext) => ToolResult | Promise<ToolResult>;
}): AssistantToolDefinition {
  return definition as unknown as AssistantToolDefinition;
}
