import { Inject, Injectable } from '@nestjs/common';
import type { CustomFieldScope, CustomFieldUsage } from '@nodus/contracts';

import {
  CUSTOM_FIELD_VALUES_READER,
  type CustomFieldValuesReader,
} from '../../tasks/ports/custom-field-values.port.js';
import {
  LETTER_FIELD_VALUES_READER,
  type LetterFieldValuesReader,
} from '../../correspondence/ports/letter-field-values.port.js';
import {
  PROJECT_FIELD_USAGE_READER,
  type ProjectFieldScope,
  type ProjectFieldUsageReader,
} from '../../projects/ports/project-field-usage.port.js';
import {
  WORKFLOW_FIELD_USAGE_READER,
  type WorkflowFieldUsageReader,
} from '../../workflows/ports/workflow-field-usage.port.js';
import type { FieldDefinitionRow } from './definition.mapper.js';

/**
 * «Где используется атрибут» (#431/#556/#575): число заполненных сущностей,
 * маршруты процессов и формы видов папок. Значения считает порт владельца
 * области (задачи/письма/проекты), сам реестр чужие таблицы не читает (I3).
 */
@Injectable()
export class DefinitionsUsageService {
  constructor(
    @Inject(CUSTOM_FIELD_VALUES_READER) private readonly values: CustomFieldValuesReader,
    @Inject(LETTER_FIELD_VALUES_READER) private readonly letterValues: LetterFieldValuesReader,
    @Inject(PROJECT_FIELD_USAGE_READER) private readonly projectUsage: ProjectFieldUsageReader,
    @Inject(WORKFLOW_FIELD_USAGE_READER) private readonly workflows: WorkflowFieldUsageReader,
  ) {}

  async usage(definition: FieldDefinitionRow): Promise<CustomFieldUsage> {
    const scope = definition.scope as CustomFieldScope;
    const projectScope = isProjectScope(scope);
    const values = scope === 'letter' ? this.letterValues : this.values;
    const [valueCount, workflows, nodeKinds] = await Promise.all([
      projectScope
        ? this.projectUsage.countValues(scope, definition.id)
        : values.countValues(scope, definition.id),
      this.workflows.workflowsUsingField(scope, definition.id),
      scope === 'node' ? this.projectUsage.nodeKindsUsing(definition.id) : Promise.resolve([]),
    ]);
    return { valueCount, workflows, nodeKinds };
  }
}

function isProjectScope(scope: CustomFieldScope): scope is ProjectFieldScope {
  return scope === 'project' || scope === 'node';
}
