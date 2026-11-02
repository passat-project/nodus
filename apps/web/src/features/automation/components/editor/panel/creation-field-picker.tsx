import { useMemo, useState } from 'react';
import type {
  CreationFieldKey,
  CreationForm,
  CustomFieldDefinition,
  ProcessType,
} from '@nodus/contracts';
import { TASK_CREATION_SYSTEM_KEYS, customFieldKey, typeIdsOf, ui } from '@nodus/contracts';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { Plus } from 'lucide-react';

import { projectsAvailable } from '../../../../../shared/api/projects-available.js';
import { CustomFieldTypeIcon } from '../../../../../shared/custom-fields/field-type-icon.js';
import { useCustomFieldDefinitions } from '../../../../../shared/custom-fields/queries.js';
import { useCanManageFields } from '../../../../../shared/custom-fields/use-can-manage-fields.js';
import { useBindFieldType } from '../../../api/custom-fields-api.js';
import { unusedKeys } from '../../../model/creation-form.js';
import { FieldDialog } from '../../fields/field-dialog.js';
import { PanelAction } from '../../../../../shared/ui/panel/panel-kit.js';

const c = ui.automation.creation;

/**
 * «+ Поле» панели «Окно создания» (#432, Р12) — тихое действие панели, как
 * «+ Добавить переход». Группы «Системные», «Атрибуты типа», «Добавить в
 * тип» и «Создать атрибут…». В форму попадают только привязанные к типу
 * атрибуты (Р8): чужой атрибут сначала привязывается (быстрый путь) — иначе
 * публикация отклонила бы форму.
 */
export function CreationFieldPicker({
  type,
  form,
  disabled,
  onPick,
}: {
  type: ProcessType;
  form: CreationForm;
  disabled: boolean;
  onPick: (key: CreationFieldKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { data: definitions } = useCustomFieldDefinitions(type.category);
  const canManageFields = useCanManageFields();

  const inType = useMemo(
    () => (definitions ?? []).filter((d) => typeIdsOf(d).includes(type.id) && !d.hidden),
    [definitions, type.id],
  );
  const notInType = useMemo(
    () => (definitions ?? []).filter((d) => !typeIdsOf(d).includes(type.id) && !d.hidden),
    [definitions, type.id],
  );
  const freeSystem = unusedKeys(
    form,
    TASK_CREATION_SYSTEM_KEYS.filter((key) => key !== 'project' || projectsAvailable()),
  );
  const freeAttributes = inType.filter(
    (definition) => unusedKeys(form, [customFieldKey(definition.id)]).length > 0,
  );
  const empty =
    freeSystem.length === 0 &&
    freeAttributes.length === 0 &&
    (!canManageFields || notInType.length === 0);

  function pick(key: CreationFieldKey) {
    onPick(key);
    setOpen(false);
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <PanelAction icon={Plus} disabled={disabled}>
            {c.addField}
          </PanelAction>
        </PopoverTrigger>
        <PopoverContent align="start" className="nokey w-72 p-1.5">
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto" data-no-scrollbar>
            {empty ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">{c.pickerEmpty}</p>
            ) : null}

            {freeSystem.length > 0 ? (
              <Group title={c.groups.system}>
                {freeSystem.map((key) => (
                  <Row key={key} onClick={() => pick(key)}>
                    {ui.taskCreate.fields[key as keyof typeof ui.taskCreate.fields]}
                  </Row>
                ))}
              </Group>
            ) : null}

            {freeAttributes.length > 0 ? (
              <Group title={c.groups.attributes}>
                {freeAttributes.map((definition) => (
                  <Row
                    key={definition.id}
                    definition={definition}
                    onClick={() => pick(customFieldKey(definition.id))}
                  >
                    {definition.name}
                  </Row>
                ))}
              </Group>
            ) : null}

            {canManageFields && notInType.length > 0 ? (
              <Group title={c.groups.addToType}>
                {notInType.map((definition) => (
                  <BindRow
                    key={definition.id}
                    definition={definition}
                    typeId={type.id}
                    onBound={() => pick(customFieldKey(definition.id))}
                  />
                ))}
              </Group>
            ) : null}

            {canManageFields ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreateOpen(true);
                }}
                className="mt-1 flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              >
                <Plus className="size-3.5 shrink-0" strokeWidth={1.75} />
                {c.groups.createAttribute}
              </button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>

      {createOpen ? (
        <FieldDialog
          mode={{ kind: 'create', scope: type.category, presetTypeId: type.id }}
          definitions={definitions ?? []}
          canManage={canManageFields}
          onClose={() => setCreateOpen(false)}
          onSaved={(id) => {
            setCreateOpen(false);
            onPick(customFieldKey(id));
          }}
        />
      ) : null}
    </>
  );
}

/** Строка «Добавить в тип»: привязка атрибута к типу и сразу выбор в форму.
 *  Хук привязки — свой на строку (id атрибута известен до клика). */
function BindRow({
  definition,
  typeId,
  onBound,
}: {
  definition: CustomFieldDefinition;
  typeId: string;
  onBound: () => void;
}) {
  const bind = useBindFieldType(definition.id);
  return (
    <Row
      definition={definition}
      onClick={() => {
        bind.mutate(typeId);
        onBound();
      }}
    >
      {definition.name}
    </Row>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="px-1.5 py-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {title}
      </span>
      {children}
    </div>
  );
}

/** Строка выбора; у атрибута — значок его типа (данные, не декор). */
function Row({
  children,
  definition,
  onClick,
}: {
  children: React.ReactNode;
  definition?: CustomFieldDefinition;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-accent/60"
    >
      {definition ? (
        <CustomFieldTypeIcon type={definition.type} className="size-3.5 text-muted-foreground" />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
