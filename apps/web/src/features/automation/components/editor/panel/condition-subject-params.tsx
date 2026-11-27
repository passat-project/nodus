import type {
  ConditionSubject,
  CustomFieldDefinition,
  CustomFieldKey,
  FormulaRelationDirection,
  FormulaRelationKind,
  NodeKind,
} from '@nodus/contracts';
import {
  customFieldKey,
  formulaRelationDirectionSchema,
  formulaRelationKindSchema,
  ui,
} from '@nodus/contracts';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

const RELATION_KINDS = formulaRelationKindSchema.options;
const RELATION_DIRECTIONS = formulaRelationDirectionSchema.options;
const NO_FOLDER_TYPE = '__any__';

/**
 * Параметры субъекта выборки (#635): вид и направление связи, тип папки
 * (у «папок проекта» — необязательный, «любой тип»), поле-ссылка. Правка
 * частичная — поверх текущего субъекта; у субъектов без параметров молчит.
 */
export function SubjectParams({
  subject,
  nodeKinds,
  refFields,
  readOnly,
  patch,
}: {
  subject: ConditionSubject;
  nodeKinds: readonly NodeKind[];
  /** Атрибуты-ссылки, привязанные к типу маршрута (для ref_field). */
  refFields: readonly CustomFieldDefinition[];
  readOnly: boolean;
  patch: (patch: Record<string, unknown>) => void;
}) {
  const t = ui.automation.condition;

  if (subject.kind === 'relations') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={subject.relation}
          disabled={readOnly}
          onValueChange={(relation) => patch({ relation: relation as FormulaRelationKind })}
        >
          <SelectTrigger className="w-full min-w-0" aria-label={t.subjectRelation}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            {RELATION_KINDS.map((relation) => (
              <SelectItem key={relation} value={relation}>
                {ui.formulas.relations[relation]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={subject.direction}
          disabled={readOnly}
          onValueChange={(direction) => patch({ direction: direction as FormulaRelationDirection })}
        >
          <SelectTrigger className="w-full min-w-0" aria-label={t.subjectDirection}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="nokey">
            {RELATION_DIRECTIONS.map((direction) => (
              <SelectItem key={direction} value={direction}>
                {t.subjectDirections[direction]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (subject.kind === 'project_folders' || subject.kind === 'folder_type_tasks') {
    return (
      <Select
        value={subject.folderTypeId ?? NO_FOLDER_TYPE}
        disabled={readOnly}
        onValueChange={(value) =>
          patch({ folderTypeId: value === NO_FOLDER_TYPE ? undefined : value })
        }
      >
        <SelectTrigger className="w-full min-w-0" aria-label={t.subjectFolderType}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="nokey">
          {subject.kind === 'project_folders' ? (
            <SelectItem value={NO_FOLDER_TYPE}>{t.subjectFolderTypeAny}</SelectItem>
          ) : null}
          {nodeKinds.map((kind) => (
            <SelectItem key={kind.id} value={kind.id}>
              {kind.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (subject.kind === 'ref_field') {
    return (
      <Select
        value={subject.field}
        disabled={readOnly}
        onValueChange={(field) => patch({ field: field as CustomFieldKey })}
      >
        <SelectTrigger className="w-full min-w-0" aria-label={t.subjectField}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="nokey">
          {refFields.map((definition) => (
            <SelectItem key={definition.id} value={customFieldKey(definition.id)}>
              {definition.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return null;
}
