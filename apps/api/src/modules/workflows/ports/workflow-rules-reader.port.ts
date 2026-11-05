import type { InjectionToken } from '@nestjs/common';
import type { DeciderSource, ProcessCategory } from '@nodus/contracts';

/**
 * Read-порт правил маршрутов для источников решающих (#433, ADR-0012):
 * модуль tasks не импортирует workflows, а спрашивает «какие живые переходы
 * кого-то ждут». Возвращается только то, что нужно движку и видимости;
 * документы и стадии — не здесь (`PROCESS_CATALOG_READER`).
 */

/** Живой переход с условиями `decider_in`. `fromStageId: null` — «из любого». */
export interface WorkflowDeciderTransition {
  workflowId: string;
  transitionId: string;
  fromStageId: string | null;
  /** Кнопку жмёт человек (`action`) или служебная (`service`) — решающих
   *  интересуют только action-кнопки. */
  intent: 'action' | 'service';
  sources: readonly DeciderSource[];
}

export interface WorkflowRulesReader {
  /** Все живые переходы категории, у которых есть хотя бы один источник
   *  решающих. Битые правила пропускаются (warn), а не роняют чтение задач. */
  deciderTransitions(category: ProcessCategory): Promise<WorkflowDeciderTransition[]>;
}

export const WORKFLOW_RULES_READER: InjectionToken = 'WORKFLOW_RULES_READER';
