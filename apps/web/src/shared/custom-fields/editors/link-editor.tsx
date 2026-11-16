import { useEffect, useRef, useState } from 'react';
import { customFieldValueSchemaOf, linkKindOf, ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { cn } from '@nodus/ui/lib/utils';

import { CustomFieldValueView, refsById } from '../value-view.js';
import { PathValueActions } from '../path-value.js';
import { EditorError, EditorTrigger, editorInputClass, type EditorProps } from './editor-kit.js';

/**
 * Ссылка или путь (Р11): `http(s)://…` открывается в новой вкладке, путь
 * `\\сервер\ресурс` показывается моно-текстом с действиями (#558: «Открыть»
 * и «Показать в папке» в оболочке, «Скопировать путь» в браузере). Грамматика —
 * общая схема контрактов: неверный ввод остаётся в поле с подсказкой.
 */
export function LinkEditor(props: EditorProps) {
  const current = typeof props.value === 'string' ? props.value : '';
  const [editing, setEditing] = useState(props.variant === 'form');
  const [text, setText] = useState(current);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = `cf-error-${props.definition.id}`;

  useEffect(() => {
    if (props.variant === 'form') setText(current);
  }, [current, props.variant]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const next = text.trim();
    if (next === current) {
      setError(false);
      if (props.variant === 'inline') setEditing(false);
      return;
    }
    if (next === '') {
      setError(false);
      props.onCommit(null);
      if (props.variant === 'inline') setEditing(false);
      return;
    }
    const parsed = customFieldValueSchemaOf(props.definition).safeParse(next);
    if (!parsed.success || linkKindOf(next) === null) {
      setError(true);
      return;
    }
    setError(false);
    props.onCommit(parsed.data);
    if (props.variant === 'inline') setEditing(false);
  }

  if (!editing) {
    // Путь — текст-триггер правки плюс действия РЯДОМ: кнопки внутри кнопки
    // запрещены, а «Открыть»/«Показать в папке» должны работать и без входа
    // в режим правки (#558).
    if (linkKindOf(current) === 'path' && !props.disabled) {
      return (
        <div className="group/field flex min-w-0 items-center gap-1">
          <EditorTrigger
            variant={props.variant}
            disabled={props.disabled}
            ariaLabel={props.definition.name}
            onClick={() => setEditing(true)}
          >
            <span className="truncate font-mono text-[13px]">
              {current || ui.customFields.value.empty}
            </span>
          </EditorTrigger>
          {current ? <PathValueActions path={current} /> : null}
        </div>
      );
    }
    return (
      <EditorTrigger
        variant={props.variant}
        disabled={props.disabled}
        ariaLabel={props.definition.name}
        onClick={() => !props.disabled && setEditing(true)}
      >
        <CustomFieldValueView
          definition={props.definition}
          value={props.value}
          refs={refsById(props.refs)}
          interactive={false}
        />
      </EditorTrigger>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Input
        ref={inputRef}
        value={text}
        disabled={props.disabled}
        aria-label={props.definition.name}
        aria-invalid={error || undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder={ui.customFields.value.linkPlaceholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setText(current);
            setError(false);
            setEditing(false);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className={cn(editorInputClass(props.variant), 'text-sm')}
      />
      {error ? <EditorError id={errorId} text={ui.customFields.value.invalidLink} /> : null}
    </div>
  );
}
