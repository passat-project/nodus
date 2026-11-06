import { Inject, Injectable } from '@nestjs/common';
import type { CustomFieldUsage } from '@nodus/contracts';

import {
  CUSTOM_FIELD_VALUES_READER,
  type CustomFieldValuesReader,
} from '../../tasks/ports/custom-field-values.port.js';
import {
  LETTER_FIELD_VALUES_READER,
  type LetterFieldValuesReader,
} from '../../correspondence/ports/letter-field-values.port.js';
import {
  COUNTERPARTY_FIELD_VALUES_READER,
  type CounterpartyFieldValuesReader,
} from '../../crm/ports/counterparty-field-values.port.js';
import {
  PROJECT_FIELD_USAGE_READER,
  type ProjectFieldUsageReader,
} from '../../projects/ports/project-field-usage.port.js';
import {
  FIELD_BINDING_TARGET_READER,
  type FieldBindingTargetReader,
} from '../../projects/ports/field-binding-targets.port.js';
import {
  PROCESS_CATALOG_READER,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import {
  WORKFLOW_FIELD_USAGE_READER,
  type WorkflowFieldUsageReader,
} from '../../workflows/ports/workflow-field-usage.port.js';
import { bindingsOf, type FieldDefinitionRow } from './definition.mapper.js';
import { FormulaCellsRepository } from '../formulas/formula-cells.repository.js';

/**
 * «Где используется атрибут» (Р8 #631) — агрегат последствий для окна
 * удаления: значения по видам сущностей (каждый владелец считает свой
 * JSONB, I3; контрагенты — порт crm, #646), формы (создания процессов,
 * включая непубликуемые черновики; типов проектов; видов папок),
 * опубликованные маршруты, привязки с именами целей и факт глобального
 * значения. Удаление разрешено всегда — usage информирует, не блокирует.
 */
@Injectable()
export class DefinitionsUsageService {
  constructor(
    @Inject(CUSTOM_FIELD_VALUES_READER) private readonly taskValues: CustomFieldValuesReader,
    @Inject(LETTER_FIELD_VALUES_READER) private readonly letterValues: LetterFieldValuesReader,
    @Inject(COUNTERPARTY_FIELD_VALUES_READER)
    private readonly counterpartyValues: CounterpartyFieldValuesReader,
    @Inject(PROJECT_FIELD_USAGE_READER) private readonly projectUsage: ProjectFieldUsageReader,
    @Inject(WORKFLOW_FIELD_USAGE_READER) private readonly workflows: WorkflowFieldUsageReader,
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(FIELD_BINDING_TARGET_READER) private readonly targets: FieldBindingTargetReader,
    private readonly formulaCells: FormulaCellsRepository,
  ) {}

  async usage(definition: FieldDefinitionRow): Promise<CustomFieldUsage> {
    const bindings = bindingsOf(definition);
    const [
      taskCount,
      letterCount,
      counterpartyCount,
      projectCount,
      nodeCount,
      processForms,
      projectForms,
      workflows,
      processTypes,
      projectTypes,
      nodeKinds,
      ownCells,
      typeDefaults,
      windowSlots,
    ] = await Promise.all([
      this.taskValues.countValues(definition.id),
      this.letterValues.countValues(definition.id),
      this.counterpartyValues.countValues(definition.id),
      this.projectUsage.countValues('project', definition.id),
      this.projectUsage.countValues('node', definition.id),
      this.workflows.creationFormsUsingField(definition.id),
      this.projectUsage.formsUsingField(definition.id),
      this.workflows.workflowsUsingField(definition.id),
      this.catalog.typeRefs(bindings.processTypeIds),
      this.targets.projectTypes(),
      this.targets.nodeKinds(),
      this.formulaCells.countByFieldId(definition.id),
      this.formulaCells.countTypeDefaults(definition.id),
      this.workflows.formulaSlotsUsingField(definition.id),
    ]);

    const nameById = (rows: { id: string; name: string }[], ids: readonly string[]) =>
      ids
        .map((id) => rows.find((row) => row.id === id))
        .filter((row): row is { id: string; name: string } => row !== undefined)
        .map((row) => ({ id: row.id, name: row.name }));

    return {
      values: {
        task: taskCount,
        letter: letterCount,
        counterparty: counterpartyCount,
        project: projectCount,
        node: nodeCount,
      },
      forms: [...processForms, ...projectForms],
      workflows,
      bindings: {
        processTypes: nameById(processTypes, bindings.processTypeIds),
        projectTypes: nameById(projectTypes, bindings.projectTypeIds),
        nodeKinds: nameById(nodeKinds, bindings.nodeKindIds),
      },
      companyValue: definition.companyValue !== null,
      formulas: { ownCells, typeDefaults, windowSlots },
    };
  }
}
