import { useState } from 'react';
import { Input } from '@nodus/ui/components/input';
import { Textarea } from '@nodus/ui/components/textarea';

/**
 * Поля панели с сохранением по уходу фокуса (однострочное — и по Enter):
 * правка живёт локально, наружу уходит одно значение, а не каждая буква
 * (настройки типа сохраняются сразу — запрос на букву недопустим). Пришло
 * новое значение извне (WS, откат мутации) — черновик пересинхронизируется
 * во время рендера, без эффекта (канон React: adjusting state on prop change).
 * `required` — пустое не сохраняется: поле возвращает прежнее значение.
 */
function useCommitDraft(value: string, onCommit: (next: string) => void, required: boolean) {
  const [text, setText] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(value);
  }
  const commit = () => {
    const next = text.trim();
    if (next === value.trim() || (required && next === '')) {
      setText(value);
      return;
    }
    onCommit(next);
  };
  return { text, setText, commit };
}

type CommitProps = {
  value: string;
  onCommit: (next: string) => void;
  required?: boolean;
};

export function CommitInput({
  value,
  onCommit,
  required = false,
  ...props
}: CommitProps & Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'onBlur'>) {
  const { text, setText, commit } = useCommitDraft(value, onCommit, required);
  return (
    <Input
      {...props}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
      }}
    />
  );
}

export function CommitTextarea({
  value,
  onCommit,
  required = false,
  ...props
}: CommitProps & Omit<React.ComponentProps<typeof Textarea>, 'value' | 'onChange' | 'onBlur'>) {
  const { text, setText, commit } = useCommitDraft(value, onCommit, required);
  return (
    <Textarea
      {...props}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
    />
  );
}
