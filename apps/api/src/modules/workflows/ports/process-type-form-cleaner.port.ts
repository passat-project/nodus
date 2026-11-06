import type { InjectionToken } from '@nestjs/common';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';

/**
 * Уборка формы создания маршрута при удалении/отвязке атрибута (#646).
 * Форма создания живёт в `workflows.creation` (опубликованный документ),
 * поэтому чистит её модуль-владелец «Процессов» — custom-fields не трогает
 * чужие таблицы (I3). Синхронный вызов в транзакции удаления/отвязки
 * закрывает окно outbox: required-слот `cf.<id>` удалённого атрибута иначе
 * блокирует создание задачи типа навсегда (подать значение нельзя —
 * `prepareCreate` отвечает `unknown`).
 */
export const PROCESS_TYPE_FORM_CLEANER: InjectionToken = 'PROCESS_TYPE_FORM_CLEANER';

export interface ProcessTypeFormCleaner {
  /** Снять слоты `cf.<fieldId>` из форм создания маршрутов, у которых не
   *  осталось ни одного типа с привязкой атрибута (#646).
   *
   *  `keepTypeIds` — типы процессов, у которых привязка ЕЩЁ ЕСТЬ: маршрут,
   *  обслуживающий такой тип, слот сохраняет (иначе отвязка от одного типа
   *  молча снимала бы обязательное поле у соседнего). Пустой список — снять
   *  везде (удаление определения: привязок не осталось).
   *
   *  Идемпотентно; возвращает затронутые типы процессов — событие
   *  `workflow.type_updated` эмитит сам провайдер (см. реализацию). */
  removeFieldFromCreationForms(
    fieldId: string,
    actorId: string | null,
    tx: TransactionClient,
    keepTypeIds?: readonly string[],
  ): Promise<{ typeId: string; name: string }[]>;
}
