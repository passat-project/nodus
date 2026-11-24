import { describe, expect, it } from 'vitest';
import type { ProjectListItem } from '@nodus/contracts';

import { canEditProject } from './project-edit-rights.js';

/** Права строки журнала (#559): правка — руководство или project.manage. */
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
