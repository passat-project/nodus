import type { ConversationListItem, TaskListItem } from '@nodus/contracts';

import { conversationTitle } from '../../../shared/chat/conversations.js';

/** Контекст, который ассистент «видит»: раздел, открытая карточка, мои задачи
 *  и беседы. В боевой версии это серверный контекст сессии; в концепте —
 *  те же query-хуки, что питают списки портала. */
export interface AssistantContext {
  moduleLabel: string | null;
  cardKind: string | null;
  cardTask: TaskListItem | null;
  tasks: TaskListItem[];
  conversations: ConversationListItem[];
  meId: string | null | undefined;
}

const DAY_MS = 86_400_000;

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

function isActive(t: TaskListItem): boolean {
  return !t.stage.outcome;
}

function isOverdue(t: TaskListItem, now: number): boolean {
  return isActive(t) && !!t.deadline && new Date(t.deadline).getTime() < now;
}

function taskLine(t: TaskListItem): string {
  const deadline = t.deadline ? `срок ${fmtDate(t.deadline)}` : 'без срока';
  return `№${t.number} «${t.title}» — ${deadline}, стадия «${t.stage.name}»`;
}

function hours(minutes: number): string {
  return `${Math.round(minutes / 60)} ч`;
}

/** Заготовленные ответы концепта: собираются из РЕАЛЬНЫХ мок-данных портала,
 *  чтобы диалог ощущался живым и контекстным. Никаких действий не выполняется. */
export function buildReply(text: string, ctx: AssistantContext): string {
  const q = text.toLowerCase();
  const now = Date.now();
  const active = ctx.tasks.filter(isActive);
  const overdue = active.filter((t) => isOverdue(t, now));

  if (/просроч|горит|дедлайн/.test(q)) {
    if (overdue.length === 0) {
      const next = active
        .filter((t) => t.deadline)
        .sort((a, b) => a.deadline!.localeCompare(b.deadline!))[0];
      return next
        ? `Просроченных задач в вашем списке нет. Ближайший срок — ${taskLine(next)}. Могу свести план на день.`
        : 'Просроченных задач в вашем списке нет, и открытых сроков тоже. Хороший момент, чтобы разобрать входящие письма.';
    }
    const lines = overdue
      .slice(0, 5)
      .map((t, i) => `${i + 1}. ${taskLine(t)}.`)
      .join('\n');
    return `Смотрю журнал задач: просрочено ${overdue.length}.\n\n${lines}\n\nПредлагаю начать с самой давней и перенести срок или закрыть задачу. В боевой версии я бы сделал это одной кнопкой — пока это концепт.`;
  }

  if (/день|план|недел/.test(q)) {
    const today = active.filter((t) => t.deadline && new Date(t.deadline).getTime() < now + DAY_MS);
    const parts: string[] = [];
    if (overdue.length > 0)
      parts.push(`Сначала просрочка (${overdue.length}): ${taskLine(overdue[0]!)}.`);
    if (today.length > 0)
      parts.push(
        `Со сроком сегодня/завтра: ${today
          .slice(0, 3)
          .map((t) => `№${t.number} «${t.title}»`)
          .join('; ')}.`,
      );
    parts.push(
      `Всего в работе ${active.length} задач. Совет: начните с самой давней просрочки, затем закройте то, что горит сегодня.`,
    );
    return `План на день по вашим задачам:\n\n${parts.join('\n\n')}`;
  }

  if (/резолюц|письм/.test(q)) {
    const due = fmtDate(new Date(now + 3 * DAY_MS).toISOString());
    return `Черновик резолюции (концепт, текст для правки):\n\n«Прошу рассмотреть в срок до ${due}. Ответственный: исполнитель по умолчанию. О результате доложить поручением в Nodus.»\n\nВ боевой версии я подставлю адресата и срок из письма и создам поручение-задачу одной кнопкой — с трекингом времени.`;
  }

  if (ctx.cardKind === 'task' && ctx.cardTask) {
    const t = ctx.cardTask;
    const spent = t.spentMinutes > 0 ? hours(t.spentMinutes) : 'не учитывались';
    const plan = t.plannedMinutes ? ` из ${hours(t.plannedMinutes)} плана` : '';
    return `Карточка перед вами: №${t.number} «${t.title}».\n\nСтадия «${t.stage.name}», ${t.deadline ? `срок ${fmtDate(t.deadline)}` : 'без срока'}. Исполнитель: ${t.assignee?.displayName ?? 'не назначен'}. ${t.project ? `Проект: «${t.project.name}».` : 'Без проекта.'} Трудозатраты: ${spent}${plan}.\n\nМогу собрать сводку для руководителя или предложить разбить задачу на подзадачи — в концепте это текст, не действия.`;
  }

  if (ctx.moduleLabel === 'Мессенджер' || ctx.cardKind === 'messenger') {
    const unread = ctx.conversations.filter((c) => c.unreadCount > 0 && !c.snoozed);
    const total = unread.reduce((sum, c) => sum + c.unreadCount, 0);
    const names = unread
      .slice(0, 3)
      .map((c) => conversationTitle(c, ctx.meId))
      .join(', ');
    return unread.length > 0
      ? `Непрочитанных бесед: ${unread.length}, сообщений: ${total}.\n\nСамые активные: ${names}.\n\nМогу пересказать непрочитанное или найти сообщение по смыслу — в концепте показываю только сводку.`
      : 'Непрочитанных бесед нет. Могу найти сообщение по смыслу или пересказать длинный тред — в концепте это заготовка.';
  }

  const where = ctx.moduleLabel ? `Вы в разделе «${ctx.moduleLabel}»` : 'Вы на главной';
  const card = ctx.cardTask ? `, открыта карточка №${ctx.cardTask.number}` : '';
  return `${where}${card}.\n\nЯ вижу ваши задачи, письма и беседы. В концепте умею:\n— свести план на день и просрочку;\n— рассказать об открытой карточке;\n— набросать резолюцию к письму.\n\nСпросите своими словами или нажмите подсказку.`;
}
