import type { NumberSegmentEmptyDetails } from '@nodus/contracts';
import {
  ErrorCode,
  errorMessages,
  numberContainerMissingDetailsSchema,
  numberSegmentEmptyDetailsSchema,
  ui,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { create } from 'zustand';

import { ApiError } from '../api-client.js';

const counter = ui.customFields.dialog.counter;

const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

/**
 * Окно «В номере есть незаполненное поле» (#630, вердикт владельца 08.11):
 * сервер не выдаёт номер с пустой вставкой молча (409 NUMBER_SEGMENT_EMPTY)
 * — человек видит, каким выйдет номер, и решает: «Выдать так» (повтор того
 * же запроса с `confirmEmptyNumberParts: true`) или «Вернуться и заполнить»
 * (ничего не выдано и не потрачено). Один хост в оболочке, zustand-стор —
 * как окна создания задачи и проекта.
 */
interface NumberConfirmState {
  request: { details: NumberSegmentEmptyDetails; resolve: (ok: boolean) => void } | null;
  ask: (details: NumberSegmentEmptyDetails) => Promise<boolean>;
  answer: (ok: boolean) => void;
}

export const useNumberConfirmStore = create<NumberConfirmState>()((set, get) => ({
  request: null,
  ask: (details) =>
    new Promise<boolean>((resolve) => {
      // Второй вопрос поверх первого не задаётся: прежний — «вернуться».
      get().request?.resolve(false);
      set({ request: { details, resolve } });
    }),
  answer: (ok) => {
    get().request?.resolve(ok);
    set({ request: null });
  },
}));

/** Человек выбрал «Вернуться и заполнить» — действие отменено без тоста. */
export class NumberConfirmCancelled extends Error {
  constructor() {
    super('number confirm cancelled');
    this.name = 'NumberConfirmCancelled';
  }
}

export const isNumberConfirmCancelled = (error: unknown): boolean =>
  error instanceof NumberConfirmCancelled;

/** Детали 409 NUMBER_SEGMENT_EMPTY, если это он (иначе null). */
function emptyDetailsOf(error: unknown): NumberSegmentEmptyDetails | null {
  if (!(error instanceof ApiError) || error.code !== ErrorCode.NUMBER_SEGMENT_EMPTY) return null;
  const parsed = numberSegmentEmptyDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

/**
 * Выполнить действие, выдающее номер (кнопка процесса, создание записи,
 * смена типа): на 409 NUMBER_SEGMENT_EMPTY — спросить человека и повторить
 * с подтверждением; «Вернуться» — `NumberConfirmCancelled`.
 */
export async function withEmptyNumberConfirm<T>(
  run: (confirmed: boolean) => Promise<T>,
): Promise<T> {
  try {
    return await run(false);
  } catch (error) {
    const details = emptyDetailsOf(error);
    if (!details) throw error;
    const ok = await useNumberConfirmStore.getState().ask(details);
    if (!ok) throw new NumberConfirmCancelled();
    return run(true);
  }
}

/** Текст отказа выдачи номера для тоста; null — это не ошибка номера. */
export function numberingErrorText(error: unknown): string | null {
  if (!(error instanceof ApiError) || !error.code.startsWith('NUMBER_')) return null;
  if (error.code === ErrorCode.NUMBER_CONTAINER_MISSING) {
    const parsed = numberContainerMissingDetailsSchema.safeParse(error.details);
    if (parsed.success) {
      const reason = fill(counter.checkReasons[parsed.data.reason], { name: parsed.data.name })
        .replace(/ — номер не будет выдан$/, '')
        .replace(/^./, (first) => first.toLowerCase());
      return fill(counter.missingToast, { field: parsed.data.fieldName, reason });
    }
  }
  return errorMessages[error.code as ErrorCode] ?? null;
}

/** Хост окна подтверждения — один на приложение (оболочка). */
export function NumberConfirmHost() {
  const request = useNumberConfirmStore((state) => state.request);
  const answer = useNumberConfirmStore((state) => state.answer);
  if (!request) return null;
  const { details } = request;
  const names = details.segments.map((segment) => segment.name).join('», «');
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : answer(false))}>
      <DialogContent className="sm:max-w-[28rem]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{counter.emptySegment.title}</DialogTitle>
          <DialogDescription>
            {fill(counter.emptySegment.body, {
              names,
              field: details.fieldName,
              example: details.example,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="items-center gap-2">
          <Button type="button" variant="ghost" onClick={() => answer(false)} autoFocus>
            {counter.emptySegment.back}
          </Button>
          <Button type="button" onClick={() => answer(true)}>
            {counter.emptySegment.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
