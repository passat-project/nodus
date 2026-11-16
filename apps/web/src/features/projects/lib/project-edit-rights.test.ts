import { describe, expect, it } from 'vitest';
import type { ProjectListItem } from '@nodus/contracts';

import { canDragProject, canEditProject } from './project-edit-rights.js';

/** Права строки журнала (#559): правка — руководство или project.manage;
 *  перетаскивание архивного проекта — только project.manage (заморозка). */
function project(
  membership: Partial<ProjectListItem['myMembership']>,
  status: ProjectListItem['status'] = 'active',
): Pick<ProjectListItem, 'myMembership' | 'status'> {
  return {
    myMembership: {
      manager: false,
      assistant: false,
      participant: false,
      observer: false,
      ...membership,
    },
    status,
  };
}

describe('canEditProject', () => {
  it('руководитель и помощник правят проект, участник — нет', () => {
    expect(canEditProject(project({ manager: true }), false)).toBe(true);
    expect(canEditProject(project({ assistant: true }), false)).toBe(true);
    expect(canEditProject(project({ participant: true }), false)).toBe(false);
    expect(canEditProject(project({ observer: true }), false)).toBe(false);
  });

  it('project.manage правит любой проект', () => {
    expect(canEditProject(project({}), true)).toBe(true);
  });
});

describe('canDragProject (#559)', () => {
  it('живой проект тащит руководство и project.manage', () => {
    expect(canDragProject(project({ manager: true }), false)).toBe(true);
    expect(canDragProject(project({ assistant: true }), false)).toBe(true);
    expect(canDragProject(project({}), true)).toBe(true);
  });

  it('архивный проект — только project.manage: иначе сервер ответит 403', () => {
    expect(canDragProject(project({ manager: true }, 'archived'), false)).toBe(false);
    expect(canDragProject(project({ assistant: true }, 'archived'), false)).toBe(false);
    expect(canDragProject(project({}), true)).toBe(true);
    expect(canDragProject(project({ manager: true }, 'archived'), true)).toBe(true);
  });

  it('чужой проект не тащится ни в каком статусе', () => {
    expect(canDragProject(project({ participant: true }), false)).toBe(false);
    expect(canDragProject(project({ observer: true }, 'archived'), false)).toBe(false);
  });
});
