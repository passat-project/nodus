import { useEffect, useState } from 'react';
import type { CreationFieldSlot, CustomFieldType, FormulaHostKind } from '@nodus/contracts';
import { customFieldIdOfKey } from '@nodus/contracts';

import { api } from '../api-client.js';

/** Тип системного слота окна создания: значение формулы материализуется
 *  грамматикой поля (дата — ISO, сотрудник — id). `priority` — строковый
 *  enum без словаря, материализация ему не нужна. */
const SLOT_TYPES: Readonly<Record<string, CustomFieldType>> = {
  description: 'long_text',
  deadline: 'datetime',
  assignee: 'user',
  coexecutors: 'users',
  observers: 'users',
  project: 'project',
};

/** Префилл формульных слотов окна создания (#632, Р12): значение считается
 *  при открытии и при смене места (проект/папка/родитель). Ошибка/нет
 *  доступа — слот остаётся пустым (Р13). `version` растёт на каждый ответ,
 *  чтобы эффект применения не зависел от идентичности объекта. */
export function useCreationFormulaPrefill({
  slots,
  hostKind,
  projectId,
  nodeId,
  parentId,
  enabled,
}: {
  slots: readonly CreationFieldSlot[];
  hostKind: FormulaHostKind;
  projectId: string | null;
  nodeId: string | null;
  parentId: string | null;
  enabled: boolean;
}): { values: Readonly<Record<string, unknown>>; version: number } {
  const [state, setState] = useState<{ values: Record<string, unknown>; version: number }>({
    values: {},
    version: 0,
  });
  const withFormula = slots.filter((slot) => slot.formula);
  const signature = withFormula
    .map((slot) => `${slot.key}:${JSON.stringify(slot.formula)}`)
    .join('|');

  useEffect(() => {
    if (!enabled) return;
    if (withFormula.length === 0) {
      setState((prev) => ({ values: {}, version: prev.version + 1 }));
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const values: Record<string, unknown> = {};
        for (const slot of withFormula) {
          try {
            const fieldId = customFieldIdOfKey(slot.key);
            const slotType = fieldId ? undefined : SLOT_TYPES[slot.key];
            const result = await api<{ value: unknown }>('/custom-fields/formulas/evaluate', {
              method: 'POST',
              body: {
                ast: slot.formula,
                ...(fieldId ? { targetFieldId: fieldId } : {}),
                ...(slotType ? { targetType: slotType } : {}),
                context: {
                  creation: {
                    hostKind,
                    ...(projectId ? { projectId } : {}),
                    ...(nodeId ? { nodeId } : {}),
                    ...(parentId ? { parentId } : {}),
                  },
                },
              },
            });
            if (result.value !== null && result.value !== undefined)
              values[slot.key] = result.value;
          } catch {
            // Нет доступа к месту или формула не посчиталась — пусто (Р13).
          }
        }
        if (!cancelled) setState((prev) => ({ values, version: prev.version + 1 }));
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- сигнатура покрывает слоты
  }, [enabled, signature, hostKind, projectId, nodeId, parentId]);

  return state;
}
