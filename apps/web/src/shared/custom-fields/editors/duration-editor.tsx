import { useEffect, useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { cn } from '@nodus/ui/lib/utils';

import { formatDuration, parseDurationInput } from '../value-format.js';
import { CustomFieldValueView, refsById } from '../value-view.js';
import { EditorError, EditorTrigger, editorInputClass, type EditorProps } from './editor-kit.js';

/**
 * Продолжительность: минуты хранятся целыми (1..100000), показ и ввод —
 * «ч:мм» (Р1). Пустое — очистить поле; неверный формат — подсказка под полем,
 * на сервер не уходит.
 */
export function DurationEditor(props: EditorProps) {
  const current = typeof props.value === 'number' ? props.value : undefined;
  const initial = current === undefined ? '' : formatDuration(current);
  const [editing, setEditing] = useState(props.variant === 'form');
  const [text, setText] = useState(initial);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = `cf-error-${props.definition.id}`;

  useEffect(() => {
    if (props.variant === 'form') setText(initial);
  }, [initial, props.variant]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    if (text.trim() === '') {
      setError(false);
      // Пусто и было пусто — формулу ячейки не снимаем.
      if (current !== undefined) props.onCommit(null);
      if (props.variant === 'inline') setEditing(false);
      return;
    }
    const minutes = parseDurationInput(text);
    if (minutes === null) {
      setError(true);
      return;
    }
    setError(false);
    // Enter без правки не должен считаться ручной записью (Р5 #632).
    if (minutes === current) {
      if (props.variant === 'inline') setEditing(false);
      return;
    }
    props.onCommit(minutes);
    if (props.variant === 'inline') setEditing(false);
  }

  if (!editing) {
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
        maxLength={10}
        aria-label={props.definition.name}
        aria-invalid={error || undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder={ui.customFields.value.durationPlaceholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            setText(initial);
            setError(false);
            setEditing(false);
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        className={cn(editorInputClass(props.variant), 'w-32 text-sm tabular-nums')}
      />
      {error ? <EditorError id={errorId} text={ui.customFields.value.invalidDuration} /> : null}
    </div>
  );
}
