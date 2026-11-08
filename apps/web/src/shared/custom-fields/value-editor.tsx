import type { CustomFieldDefinition, CustomFieldRef, CustomFieldValue } from '@nodus/contracts';
import { cn } from '@nodus/ui/lib/utils';

import { CustomFieldValueView, refsById } from './value-view.js';
import { BoolEditor } from './editors/bool-editor.js';
import { CounterpartyEditor } from './editors/counterparty-editor.js';
import { DateEditor } from './editors/date-editor.js';
import { DepartmentEditor } from './editors/department-editor.js';
import { DurationEditor } from './editors/duration-editor.js';
import { type EditorProps, type EditorVariant } from './editors/editor-kit.js';
import { LinkEditor } from './editors/link-editor.js';
import { ListEditor } from './editors/list-editor.js';
import { NumberEditor } from './editors/number-editor.js';
import { PeopleEditor } from './editors/people-editor.js';
import { ProjectEditor } from './editors/project-editor.js';
import { LetterEditor, NodeEditor, TaskEditor } from './editors/record-editors.js';
import { TextEditor } from './editors/text-editor.js';

export interface CustomFieldEditorProps {
  definition: CustomFieldDefinition;
  value?: CustomFieldValue;
  refs: readonly CustomFieldRef[];
  disabled?: boolean;
  variant: EditorVariant;
  /** Значение или `null` (очистить); `refs` — ссылка выбора для мгновенного
   *  показа имени до ответа сервера (Р6). */
  onCommit: (value: CustomFieldValue | null, refs?: CustomFieldRef[]) => void;
}

/**
 * Диспетчер редактора по типу поля (#431): один файл на семейство, здесь —
 * только выбор. Недоступное (архивное поле, нет прав) — строка значения.
 */
export function CustomFieldEditor(props: CustomFieldEditorProps) {
  const disabled = props.disabled ?? false;
  if (disabled) {
    return (
      <div
        className={cn(
          'flex min-h-7 min-w-0 items-center text-sm',
          props.variant === 'form' &&
            'h-8 w-full rounded-lg border border-input bg-muted/40 px-2.5',
        )}
      >
        <CustomFieldValueView
          definition={props.definition}
          value={props.value}
          refs={refsById(props.refs)}
        />
      </div>
    );
  }

  const editorProps: EditorProps = {
    definition: props.definition,
    value: props.value,
    refs: props.refs,
    disabled,
    variant: props.variant,
    onCommit: props.onCommit,
  };
  switch (props.definition.type) {
    case 'text':
    case 'long_text':
      return <TextEditor {...editorProps} />;
    case 'number':
    case 'money':
      return <NumberEditor {...editorProps} />;
    case 'date':
    case 'datetime':
      return <DateEditor {...editorProps} />;
    case 'duration':
      return <DurationEditor {...editorProps} />;
    case 'bool':
      return <BoolEditor {...editorProps} />;
    case 'enum':
    case 'multienum':
      return <ListEditor {...editorProps} />;
    case 'user':
    case 'users':
      return <PeopleEditor {...editorProps} />;
    case 'department':
      return <DepartmentEditor {...editorProps} />;
    case 'project':
      return <ProjectEditor {...editorProps} />;
    case 'counterparty':
      return <CounterpartyEditor {...editorProps} />;
    case 'task':
      return <TaskEditor {...editorProps} />;
    case 'letter':
      return <LetterEditor {...editorProps} />;
    case 'node':
      return <NodeEditor {...editorProps} />;
    case 'link':
      return <LinkEditor {...editorProps} />;
    case 'counter':
      // Счётчик руками не пишется (#630, Р10): редактора нет, только чтение.
      return (
        <div className="flex min-h-7 min-w-0 items-center text-sm">
          <CustomFieldValueView
            definition={props.definition}
            value={props.value}
            refs={refsById(props.refs)}
          />
        </div>
      );
  }
}
