import { Injectable } from '@nestjs/common';
import { Permission } from '@nodus/contracts';

import { FeatureFlagService } from '../../../core/feature-flags/feature-flag.service.js';
import { ViewerResolver } from '../access/task-visibility.js';
import type { TaskSearchScope, TaskViewerReader } from './task-viewer.port.js';

/** Реализация read-порта видимости задач для поиска (#952): те же наборы,
 *  что `Viewer` модуля задач, без доступа search к таблицам задач. */
@Injectable()
export class TaskViewerProvider implements TaskViewerReader {
  constructor(
    private readonly viewers: ViewerResolver,
    private readonly flags: FeatureFlagService,
  ) {}

  async resolve(actor: { id: string; permissions: readonly string[] }): Promise<TaskSearchScope> {
    // Выключенный модуль не отдаёт данные даже через порт (I10): тип задачи
    // исключён из enabledTypes, но и наборы пусты — вторая линия защиты.
    if (!(await this.flags.isEnabled('tasks'))) {
      return {
        userId: actor.id,
        subordinateIds: [],
        visibleProjectIds: [],
        hiddenProjectIds: [],
        deciderTaskIds: [],
        pressTaskIds: [],
        viewAll: false,
      };
    }
    const viewer = await this.viewers.resolve(actor);
    return {
      userId: viewer.id,
      subordinateIds: [...viewer.subordinateIds],
      visibleProjectIds: [...viewer.visibleProjectIds],
      hiddenProjectIds: [...viewer.hiddenProjectIds],
      deciderTaskIds: [...(viewer.deciderTaskIds ?? [])],
      pressTaskIds: [...(viewer.pressTaskIds ?? [])],
      viewAll: viewer.permissions.includes(Permission.TASK_VIEW_ALL),
    };
  }
}
