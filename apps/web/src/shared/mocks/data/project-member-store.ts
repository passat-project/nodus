import { appendDemoProjectEvent } from './project-events.js';
import {
  addDemoParticipant,
  demoParticipantRowsOf,
  findDemoProjectRow,
  removeDemoParticipant,
  type DemoProjectRow,
} from './projects.js';
import { touch } from './project-store.js';
import type { DemoActor } from './project-views.js';

/**
 * Мутации состава мок-мира проектов (#52, #714): вступление/уход и ручное
 * управление ролями. Событие истории несёт семантику действия (#699):
 * руководитель видит, кого добавили, сняли или кому сменили роль. Вынесено
 * из project-store.ts ради лимита файла (I5).
 */

export function joinDemoProject(id: string, actor: DemoActor): boolean {
  const row = findDemoProjectRow(id);
  if (!row || row.visibility !== 'open') return false;
  if (demoParticipantRowsOf(id).some((entry) => entry.userId === actor.id)) return true;
  addDemoParticipant({
    projectId: id,
    userId: actor.id,
    source: 'observer',
    observerKind: 'joined',
    joinedAt: new Date().toISOString(),
  });
  touch(row);
  appendDemoProjectEvent({
    projectId: id,
    kind: 'participants_changed',
    actorId: actor.id,
    fields: [],
    status: null,
    userIds: [actor.id],
    members: [{ userId: actor.id, action: 'added', from: null, to: 'observer' }],
    reason: 'join',
    visibility: null,
    name: null,
  });
  return true;
}

export function leaveDemoProject(id: string, actor: DemoActor): void {
  const hadObserver = demoParticipantRowsOf(id).some(
    (entry) => entry.userId === actor.id && entry.source === 'observer',
  );
  if (hadObserver) removeDemoParticipant(id, actor.id, 'observer');
  const row = findDemoProjectRow(id);
  if (row) touch(row);
  if (!hadObserver) return;
  appendDemoProjectEvent({
    projectId: id,
    kind: 'participants_changed',
    actorId: actor.id,
    fields: [],
    status: null,
    userIds: [actor.id],
    members: [{ userId: actor.id, action: 'removed', from: 'observer', to: null }],
    reason: 'leave',
    visibility: null,
    name: null,
  });
}

/** Ручное добавление: повтор роли — не действие; смена вида — role_changed. */
export function addDemoProjectMember(
  id: string,
  userId: string,
  kind: 'member' | 'observer',
  actorId: string,
): boolean {
  const row = findDemoProjectRow(id);
  if (!row) return false;
  const targetRows = demoParticipantRowsOf(id).filter((entry) => entry.userId === userId);
  const previousManual = targetRows.some((entry) => entry.source === 'member')
    ? ('member' as const)
    : targetRows.some((entry) => entry.source === 'observer')
      ? ('observer' as const)
      : null;
  removeDemoParticipant(id, userId, kind === 'member' ? 'observer' : 'member');
  if (kind === 'observer') removeDemoParticipant(id, userId, 'observer');
  addDemoParticipant({
    projectId: id,
    userId,
    source: kind,
    observerKind: kind === 'observer' ? 'invited' : null,
    joinedAt: new Date().toISOString(),
  });
  touch(row);
  appendDemoProjectEvent({
    projectId: id,
    kind: 'participants_changed',
    actorId,
    fields: [],
    status: null,
    userIds: [userId],
    members: [
      previousManual && previousManual !== kind
        ? { userId, action: 'role_changed', from: previousManual, to: kind }
        : { userId, action: 'added', from: null, to: kind },
    ],
    reason: 'manual',
    visibility: null,
    name: null,
  });
  return true;
}

/** Снятие ручных строк (#714): открытый — осевший member самолечением. */
export function removeDemoProjectMember(
  id: string,
  userId: string,
  actorId: string,
): { removedMember: boolean; removedObserver: boolean } {
  const targetRows = demoParticipantRowsOf(id).filter((entry) => entry.userId === userId);
  const removedMember = targetRows.some((entry) => entry.source === 'member');
  const removedObserver = targetRows.some((entry) => entry.source === 'observer');
  if (removedMember) removeDemoParticipant(id, userId, 'member');
  if (removedObserver) removeDemoParticipant(id, userId, 'observer');
  const row: DemoProjectRow | undefined = findDemoProjectRow(id);
  if (row) touch(row);
  if (removedMember || removedObserver) {
    appendDemoProjectEvent({
      projectId: id,
      kind: 'participants_changed',
      actorId,
      fields: [],
      status: null,
      userIds: [userId],
      members: [
        {
          userId,
          action: 'removed',
          from: removedMember ? 'member' : 'observer',
          to: null,
        },
      ],
      reason: 'manual',
      visibility: null,
      name: null,
    });
  }
  return { removedMember, removedObserver };
}
