import { HttpResponse } from 'msw';
import { ErrorCode, Permission } from '@nodus/contracts';
import type { NodeKind } from '@nodus/contracts';

import { getMockActor } from '../../../../shared/mocks/mock-actor.js';
import {
  accessOf,
  canSeeProject,
  myMembershipOf,
} from '../../../../shared/mocks/data/project-views.js';
import { demoProjectTypes, findDemoProjectRow } from '../../../../shared/mocks/data/projects.js';
import {
  demoNodeKinds,
  demoNodeRows,
  findDemoNodeRow,
  type DemoNodeRow,
} from '../../../../shared/mocks/data/project-nodes.js';
import type { NodeRuleIssue } from './node-form-rules.js';

/** Общие помощники моков структуры (#467, #556): доступ к управлению
 *  структурой, ответы ошибок, поиск вида/родителя, лимит глубины. */

export const forbidden = () =>
  HttpResponse.json({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' }, { status: 403 });

export const invalid = () =>
  HttpResponse.json(
    { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
    { status: 422 },
  );

export const nodeNotFound = () =>
  HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Node not found' }, { status: 404 });

export const conflict = (code: ErrorCode, message: string) =>
  HttpResponse.json({ code, message }, { status: 409 });

export const hasSetupRight = () =>
  getMockActor().permissions.includes(Permission.PROJECT_SETUP_MANAGE);

export function ruleResponse(issue: NodeRuleIssue | null) {
  return issue
    ? HttpResponse.json(
        { code: issue.code, message: issue.message, details: issue.details },
        { status: issue.status },
      )
    : null;
}

export interface DemoProjectRowGuard {
  row: NonNullable<ReturnType<typeof findDemoProjectRow>>;
}

/** Проект + право управления структурой (руководитель/помощник/manage);
 *  строковый вердикт сужается typeof — без объектных union. */
export function manageableProject(id: string): 'forbidden' | 'notfound' | DemoProjectRowGuard {
  const actor = getMockActor();
  const row = findDemoProjectRow(id);
  if (!row || !canSeeProject(row, actor)) return 'notfound';
  return accessOf(row, myMembershipOf(row.id, actor.id), actor.permissions).canManage
    ? { row }
    : 'forbidden';
}

export function guardResponse(verdict: 'forbidden' | 'notfound') {
  return verdict === 'forbidden' ? forbidden() : nodeNotFound();
}

/** Родитель папки: null (корень) или папка этого же проекта. */
export function checkedParent(projectId: string, parentId: string | null | undefined) {
  if (parentId === undefined || parentId === null) return { parent: null };
  const parent = findDemoNodeRow(parentId);
  if (!parent || parent.projectId !== projectId) return 'notfound';
  return { parent };
}

export function kindOf(kindId: string): NodeKind | undefined {
  return demoNodeKinds.find((kind) => kind.id === kindId);
}

/** Архивный вид — 409 (создание и смена вида). */
export function assertKindAlive(kind: NodeKind | undefined) {
  if (!kind) return nodeNotFound();
  return kind.archivedAt
    ? conflict(ErrorCode.PROJECT_NODE_KIND_ARCHIVED, 'Kind is archived')
    : null;
}

/** Лимит глубины с учётом высоты переносимого поддерева. */
export function subtreeHeight(row: DemoNodeRow): number {
  const children = demoNodeRows.filter((entry) => entry.parentId === row.id);
  return 1 + Math.max(0, ...children.map((child) => subtreeHeight(child)));
}

/** Допустимые виды папок типа проекта (#556): null — все. */
export function typeKindIdsOf(projectId: string): string[] | null {
  const project = findDemoProjectRow(projectId);
  return demoProjectTypes.find((type) => type.id === project?.typeId)?.kindIds ?? null;
}

/** Вид разрешён типу проекта? 422 PROJECT_NODE_KIND_NOT_ALLOWED иначе. */
export function kindAllowedForProject(projectId: string, kindId: string): boolean {
  const kindIds = typeKindIdsOf(projectId);
  return kindIds === null || kindIds.includes(kindId);
}

/** Код папки из значения атрибута «Код» (непустая строка или null). */
export function codeOfValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** 422 по грамматике значений (зеркало CUSTOM_FIELD_VALUE_INVALID). */
export function valuesInvalid(fieldIds: string[]): Response {
  return HttpResponse.json(
    {
      code: ErrorCode.CUSTOM_FIELD_VALUE_INVALID,
      message: 'Custom field values are invalid',
      details: { issues: fieldIds.map((fieldId) => ({ fieldId, reason: 'invalid' })) },
    },
    { status: 422 },
  );
}

/** Новая строка папки мок-мира (код — производная атрибута «Код»). */
export function appendNode(
  projectId: string,
  parentId: string | null,
  kindId: string,
  name: string,
  code: string | null,
  customFields: DemoNodeRow['customFields'],
): DemoNodeRow {
  const row: DemoNodeRow = {
    id: crypto.randomUUID(),
    projectId,
    parentId,
    kindId,
    name,
    code,
    customFields,
    createdAt: new Date().toISOString(),
  };
  demoNodeRows.push(row);
  return row;
}
