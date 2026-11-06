import type { UserListItem } from '@nodus/contracts';

import { PeoplePicker } from '../../ui/people-picker.js';
import { CustomFieldValueView, refsById } from '../value-view.js';
import { EditorTrigger, type EditorProps } from './editor-kit.js';

/**
 * Сотрудник и «Сотрудники (несколько)»: пикер справочника с серверным
 * поиском. Выбор несёт ссылку (имя, аватар) — карточка показывает значение
 * сразу, не дожидаясь ответа сервера (Р6); сервер проверит активность.
 */
export function PeopleEditor(props: EditorProps) {
  const multiple = props.definition.type === 'users';
  const ids = multiple
    ? Array.isArray(props.value)
      ? props.value
      : []
    : typeof props.value === 'string'
      ? [props.value]
      : [];

  function toggle(userId: string, user?: UserListItem) {
    const ref = user
      ? {
          kind: 'user' as const,
          id: user.id,
          name: user.displayName,
          avatarUrl: user.avatarUrl,
          archived: user.status !== 'active',
        }
      : undefined;
    if (multiple) {
      const next = new Set(ids);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      const list = [...next];
      props.onCommit(list.length > 0 ? list : null, ref ? [ref] : undefined);
      return;
    }
    // Повторный выбор того же сотрудника — не ручная запись (Р5 #632).
    if (props.value !== userId) props.onCommit(userId, ref ? [ref] : undefined);
  }

  return (
    <PeoplePicker
      selectedIds={ids}
      multiple={multiple}
      onToggle={toggle}
      ariaLabel={props.definition.name}
    >
      <EditorTrigger
        variant={props.variant}
        disabled={props.disabled}
        ariaLabel={props.definition.name}
      >
        <CustomFieldValueView
          definition={props.definition}
          value={props.value}
          refs={refsById(props.refs)}
        />
      </EditorTrigger>
    </PeoplePicker>
  );
}
