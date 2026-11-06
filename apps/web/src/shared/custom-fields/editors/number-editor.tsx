import { useEffect, useRef, useState } from 'react';
import type { MoneyValue } from '@nodus/contracts';
import { SystemDictionary, ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { cn } from '@nodus/ui/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';

import { useDictionaryItems } from '../../dictionaries/queries.js';
import { formatNumber, parseNumber } from '../value-format.js';
import { CustomFieldValueView, refsById } from '../value-view.js';
import { EditorError, EditorTrigger, editorInputClass, type EditorProps } from './editor-kit.js';

/**
 * Число и деньги: ввод в русской записи (пробелы групп, запятая), точность —
 * из настроек поля; у денег рядом валюта из системного справочника `currency`
 * (Р1/Р10). Ошибка ввода не уходит на сервер — подсказка под полем.
 */
export function NumberEditor(props: EditorProps) {
  const money = props.definition.type === 'money';
  const precision = money ? 2 : (props.definition.settings.precision ?? 0);
  const moneyValue = money ? (props.value as MoneyValue | undefined) : undefined;
  const numberValue = !money ? (props.value as number | undefined) : undefined;
  const initial =
    moneyValue !== undefined
      ? formatNumber(moneyValue.amount, 2)
      : numberValue !== undefined
        ? formatNumber(numberValue, precision)
        : '';

  const [editing, setEditing] = useState(props.variant === 'form');
  const [text, setText] = useState(initial);
  const [currencyId, setCurrencyId] = useState(
    moneyValue?.currencyId ?? props.definition.settings.currencyId ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  // Список валют открыт: правка суммы не должна завершаться на его открытии
  // (иначе селект размонтируется и валюту не сменить — баг 25.10.2026).
  const [selectOpen, setSelectOpen] = useState(false);
  const skipBlur = useRef(false);
  const committedText = useRef(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: currencies = [] } = useDictionaryItems(SystemDictionary.CURRENCY);
  const activeCurrencies = currencies.filter((c) => c.isActive);
  const effectiveCurrency =
    currencyId || props.definition.settings.currencyId || activeCurrencies[0]?.id || '';
  const errorId = `cf-error-${props.definition.id}`;

  useEffect(() => {
    if (props.variant === 'form') setText(initial);
  }, [initial, props.variant]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    const next = parseNumber(text, precision);
    if (text.trim() === '') {
      setError(null);
      // Пусто и было пусто — не «вписал руками»: формула ячейки остаётся.
      if (props.value !== undefined && props.value !== null) props.onCommit(null);
      if (props.variant === 'inline') setEditing(false);
      return;
    }
    if (next === null) {
      setError(
        precision > 0
          ? ui.customFields.value.invalidPrecision
          : ui.customFields.value.invalidNumber,
      );
      return;
    }
    setError(null);
    if (money) {
      if (!effectiveCurrency) return;
      if (moneyValue?.amount === next && moneyValue.currencyId === effectiveCurrency) {
        if (props.variant === 'inline') setEditing(false);
        return;
      }
      props.onCommit({ amount: next, currencyId: effectiveCurrency } satisfies MoneyValue);
    } else {
      if (numberValue === next) {
        if (props.variant === 'inline') setEditing(false);
        return;
      }
      props.onCommit(next);
    }
    committedText.current = text;
    if (props.variant === 'inline') setEditing(false);
  }

  /** Закрытие списка валют: правка завершается (сумма уже сохранена выбором
   *  валюты; изменившийся текст — коммитим). */
  function finishAfterSelect() {
    if (props.variant !== 'inline') return;
    if (text !== committedText.current) commit();
    else setEditing(false);
  }

  function cancel() {
    setText(initial);
    setError(null);
    setEditing(false);
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
      <div className="flex min-w-0 items-center gap-1.5">
        <Input
          ref={inputRef}
          value={text}
          disabled={props.disabled}
          inputMode="decimal"
          aria-label={props.definition.name}
          aria-invalid={error !== null || undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder={
            money
              ? ui.customFields.value.amountPlaceholder
              : ui.customFields.value.numberPlaceholder
          }
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => {
            if (skipBlur.current) {
              skipBlur.current = false;
              return;
            }
            // Фокус ушёл на выбор валюты — редактор живёт дальше.
            if ((e.relatedTarget as Element | null)?.closest('[data-slot=select-trigger]')) return;
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          className={cn(editorInputClass(props.variant), 'min-w-0 flex-1 text-sm tabular-nums')}
        />
        {money ? (
          <Select
            open={selectOpen}
            value={effectiveCurrency || undefined}
            disabled={props.disabled || activeCurrencies.length === 0}
            onOpenChange={(open) => {
              setSelectOpen(open);
              if (!open) finishAfterSelect();
            }}
            onValueChange={(id) => {
              setCurrencyId(id);
              const next = parseNumber(text, 2);
              if (next !== null && (moneyValue?.amount !== next || moneyValue.currencyId !== id)) {
                props.onCommit({ amount: next, currencyId: id } satisfies MoneyValue);
                committedText.current = text;
              }
            }}
          >
            <SelectTrigger
              className={cn(props.variant === 'inline' ? 'h-7' : 'h-8', 'w-24 shrink-0 text-sm')}
              aria-label={ui.customFields.dialog.currency}
              onPointerDown={() => {
                skipBlur.current = true;
              }}
            >
              <SelectValue placeholder={ui.customFields.dialog.currency} />
            </SelectTrigger>
            <SelectContent position="popper" align="end" sideOffset={4}>
              {activeCurrencies.map((currency) => (
                <SelectItem key={currency.id} value={currency.id}>
                  {currency.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
      {error ? <EditorError id={errorId} text={error} /> : null}
    </div>
  );
}
