import { useEffect, useRef, useState } from 'react';
import { CUSTOM_FIELD_LIMITS } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Textarea } from '@nodus/ui/components/textarea';
import { cn } from '@nodus/ui/lib/utils';

import { CustomFieldValueView, refsById } from '../value-view.js';
import {
  EditorTrigger,
  editorInputClass,
  editorTextareaClass,
  type EditorProps,
} from './editor-kit.js';

/**
 * Текст и многострочный текст: правка по месту. Одиночная строка
 * фиксируется Enter или уходом фокуса, многострочная — уходом фокуса
 * (Enter внутри текста — перенос). Escape возвращает прежнее значение.
 * Ввод в карточке — того же габарита, что строка-значение: активация не
 * сдвигает карточку (editor-kit).
 */
export function TextEditor(props: EditorProps) {
  const multiline = props.definition.type === 'long_text';
  const current = typeof props.value === 'string' ? props.value : '';
  const [editing, setEditing] = useState(props.variant === 'form');
  const [text, setText] = useState(current);
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (props.variant === 'form') setText(current);
  }, [current, props.variant]);

  useEffect(() => {
    if (!editing) return;
    // Карточка/чат могут перехватить фокус сразу после клика: ставим курсор
    // в следующем кадре, когда инпут уже в DOM и родительские обработчики
    // клика отработали.
    const frame = requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      node.focus();
      const end = node.value.length;
      node.setSelectionRange(end, end);
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  const commit = () => {
    const next = text.trim();
    if (next === current.trim()) {
      if (props.variant === 'inline') setEditing(false);
      return;
    }
    props.onCommit(next.length > 0 ? next : null);
    if (props.variant === 'inline') setEditing(false);
  };

  const cancel = () => {
    setText(current);
    setEditing(false);
  };

  if (!editing) {
    return (
      <EditorTrigger
        variant={props.variant}
        disabled={props.disabled}
        ariaLabel={props.definition.name}
        multiline={multiline}
        onPointerDown={(event) => event.stopPropagation()}
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

  const shared = {
    value: text,
    disabled: props.disabled,
    'aria-label': props.definition.name,
    maxLength: multiline ? CUSTOM_FIELD_LIMITS.longText : CUSTOM_FIELD_LIMITS.text,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setText(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
      if (!multiline && e.key === 'Enter') {
        e.preventDefault();
        commit();
      }
    },
  } as const;

  return multiline ? (
    <Textarea
      {...shared}
      className={cn('text-sm [field-sizing:content]', editorTextareaClass(props.variant))}
    />
  ) : (
    <Input {...shared} className={cn(editorInputClass(props.variant), 'text-sm')} />
  );
}
