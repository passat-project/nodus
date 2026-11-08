import { z } from 'zod';

/**
 * «Внутри чего свой счёт» счётчика (#630, концепция 08.11): контейнер — это
 * РЕАЛЬНАЯ запись, внутри которой лежит нумеруемая (папка выбранного вида,
 * проект, портфель, родительская задача, значение поля), а не абстрактный
 * «разрез» или формула. Система находит контейнер по месту записи в дереве —
 * тем же путём, что формулы «ближайшая папка вида…». Одна функция для
 * сервера (выдача, проверка на записи), веба (подсказки) и моков.
 */

/** Типы атрибутов, значение которых может быть контейнером счёта: одиночная
 *  ссылка на запись или вариант списка (id стабилен при переименовании). */
export const NUMBER_CONTAINER_FIELD_TYPES = [
  'enum',
  'user',
  'department',
  'project',
  'counterparty',
  'task',
  'letter',
  'node',
] as const;

export const numberContainerSchema = z.discriminatedUnion('kind', [
  /** Вся компания — один общий счёт (сквозной номер, книга изменений). */
  z.object({ kind: z.literal('company') }).strict(),
  /** Каждая папка выбранного вида (Комплект, Здание…) — ближайшая СНАРУЖИ
   *  записи: у задачи — её папка или ближайшая выше; у папки — предки. */
  z.object({ kind: z.literal('folder'), nodeKindId: z.uuid() }).strict(),
  /** Каждый проект записи. */
  z.object({ kind: z.literal('project') }).strict(),
  /** Каждая папка, в которой лежит запись (любого вида): у задачи — её
   *  папка, у папки — родительская; в корне проекта — сам проект. «Номер
   *  комплекта внутри своего здания» без выбора вида. */
  z.object({ kind: z.literal('parent_folder') }).strict(),
  /** Каждый тип проекта записи: все проекты одного типа — один сквозной
   *  счёт («все жилые дома вместе, все школы отдельно»). */
  z.object({ kind: z.literal('project_type') }).strict(),
  /** Каждый портфель проекта записи. */
  z.object({ kind: z.literal('portfolio') }).strict(),
  /** Каждая родительская задача (подзадачи нумеруются внутри работы). */
  z.object({ kind: z.literal('parent_task') }).strict(),
  /** Каждое значение поля записи (ссылка или вариант списка): адрес —
   *  внутренний номер атрибута, переименование ничего не ломает. */
  z.object({ kind: z.literal('field'), fieldNumber: z.number().int().min(1) }).strict(),
]);
export type NumberContainer = z.infer<typeof numberContainerSchema>;
export type NumberContainerKind = NumberContainer['kind'];

/** Записи, которые могут получать номер (сторона «Кто получает номер»). */
export const numberHostKindSchema = z.enum(['task', 'letter', 'node', 'project']);
export type NumberHostKind = z.infer<typeof numberHostKindSchema>;

/** У кого есть кнопки процесса (`processCategorySchema` — task|letter).
 *  Папки и проекты кнопок не имеют: номер им выдаётся при создании (а с
 *  #448/#634 — правилом/шагом автоматизации). */
export function numberHostHasButtons(host: NumberHostKind): boolean {
  return host === 'task' || host === 'letter';
}

/** Может ли запись этого вида вообще лежать внутри такого контейнера.
 *  «Нет» — несовместимая привязка: интерфейс её не даёт выбрать, сервер
 *  отклоняет 422 `NUMBER_CONTAINER_UNREACHABLE`. Контейнер всегда СНАРУЖИ
 *  записи: проект сам себя не содержит, папка — сама себя. */
export function numberContainerReachable(
  container: NumberContainer,
  host: NumberHostKind,
): boolean {
  switch (container.kind) {
    case 'company':
    case 'portfolio':
    case 'project_type':
    case 'field':
      return true;
    case 'folder':
    case 'parent_folder':
      return host === 'task' || host === 'node';
    case 'project':
      return host !== 'project';
    case 'parent_task':
      return host === 'task';
  }
}

/** Место записи в дереве — всё, что нужно для поиска контейнера. Загружает
 *  вызывающий (сервер — порты модулей, моки — мок-мир). */
export interface NumberPlace {
  host: NumberHostKind;
  /** Папки СНАРУЖИ записи от ближайшей вверх: у задачи — её папка и предки;
   *  у папки — только предки (без самой); у письма и проекта — пусто. */
  folders: readonly { id: string; kindId: string }[];
  /** Проект записи (у проекта-хоста — null: сам себя не содержит). */
  projectId: string | null;
  /** Портфель проекта записи (у проекта-хоста — его портфель). */
  portfolioId: string | null;
  /** Тип проекта записи (у проекта-хоста — его собственный тип). */
  projectTypeId: string | null;
  /** Родительская задача (только у задачи). */
  parentTaskId: string | null;
  /** Значение одиночного поля по внутреннему номеру атрибута (uuid ссылки
   *  или варианта); пусто/нет атрибута — null. */
  fieldValue: (fieldNumber: number) => string | null;
}

/** Почему номер не выдан: у записи нет нужного контейнера. */
export const numberContainerMissingReasonSchema = z.enum([
  'unreachable',
  'no_folder',
  'no_project',
  'no_portfolio',
  'no_parent',
  'empty_field',
]);
export type NumberContainerMissingReason = z.infer<typeof numberContainerMissingReasonSchema>;

export type NumberContainerResolution =
  { ok: true; containerId: string | null } | { ok: false; reason: NumberContainerMissingReason };

/** Контейнер записи: id реальной папки/проекта/портфеля/задачи/значения или
 *  null — «вся компания». Не нашлось — причина (выдача отказывает 409
 *  `NUMBER_CONTAINER_MISSING`, номер не тратится). */
export function resolveNumberContainer(
  container: NumberContainer,
  place: NumberPlace,
): NumberContainerResolution {
  if (!numberContainerReachable(container, place.host)) return { ok: false, reason: 'unreachable' };
  switch (container.kind) {
    case 'company':
      return { ok: true, containerId: null };
    case 'folder': {
      const folder = place.folders.find((entry) => entry.kindId === container.nodeKindId);
      return folder ? { ok: true, containerId: folder.id } : { ok: false, reason: 'no_folder' };
    }
    case 'project':
      return place.projectId
        ? { ok: true, containerId: place.projectId }
        : { ok: false, reason: 'no_project' };
    case 'parent_folder': {
      const parent = place.folders[0]?.id ?? place.projectId;
      return parent ? { ok: true, containerId: parent } : { ok: false, reason: 'no_project' };
    }
    case 'project_type':
      return place.projectTypeId
        ? { ok: true, containerId: place.projectTypeId }
        : { ok: false, reason: 'no_project' };
    case 'portfolio':
      if (place.host !== 'project' && !place.projectId) return { ok: false, reason: 'no_project' };
      return place.portfolioId
        ? { ok: true, containerId: place.portfolioId }
        : { ok: false, reason: 'no_portfolio' };
    case 'parent_task':
      return place.parentTaskId
        ? { ok: true, containerId: place.parentTaskId }
        : { ok: false, reason: 'no_parent' };
    case 'field': {
      const value = place.fieldValue(container.fieldNumber);
      return value ? { ok: true, containerId: value } : { ok: false, reason: 'empty_field' };
    }
  }
}
