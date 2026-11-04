import { describe, expect, it } from 'vitest';
import {
  Permission,
  chatMessageBlockSchema,
  checkWorkflowDocument,
  executeTransitionBodySchema,
  hasBlockingProblems,
  letterDetailSchema,
  letterHistoryEntrySchema,
  letterListItemSchema,
  letterTreeResponseSchema,
  workflowDocumentSchema,
} from '@nodus/contracts';

import { letterMessages } from '../../../../shared/mocks/data/chat-letters.js';
import {
  incomingLetterDocument,
  outgoingLetterDocument,
} from '../../../../shared/mocks/data/letter-catalog.js';
import {
  boxOf,
  canSeeLetter,
  demoLetters,
  letterDetailOf,
  letterHistory,
  letterListItemOf,
  letterTreeOf,
  lettersCountOf,
  nextLetterNumber,
} from '../../../../shared/mocks/data/letters.js';
import { userIds } from '../../../../shared/mocks/data/users.js';
import { registrationIssueOf } from './letters-mock-checks.js';
import { letterTransitionsOf } from './letters-transition-handlers.js';

const registrar = { id: 'u-office', permissions: [Permission.CORRESPONDENCE_REGISTER] };
const employee = { id: 'u-employee', permissions: [Permission.DIRECTORY_READ] };

describe('мок-мир писем v3 (#55, §7.6) парсится контрактами', () => {
  it('каждое письмо — валидный элемент списка и карточка', () => {
    for (const letter of demoLetters) {
      expect(() => letterListItemSchema.parse(letterListItemOf(letter))).not.toThrow();
      expect(() => letterDetailSchema.parse(letterDetailOf(letter, registrar))).not.toThrow();
    }
  });

  it('журнал и блок причины в чате — по контрактам', () => {
    for (const entries of letterHistory.values()) {
      for (const entry of entries)
        expect(() => letterHistoryEntrySchema.parse(entry)).not.toThrow();
    }
    const blocks = letterMessages.filter((m) => m.block);
    expect(blocks).toHaveLength(1);
    expect(chatMessageBlockSchema.parse(blocks[0]?.block).kind).toBe('letter_transition');
  });

  it('маршруты писем проходят проверку документа категории letter', () => {
    for (const doc of [incomingLetterDocument, outgoingLetterDocument]) {
      expect(() => workflowDocumentSchema.parse(doc)).not.toThrow();
      const problems = checkWorkflowDocument(doc, {
        category: 'letter',
        numberingConfigured: true,
      });
      expect(hasBlockingProblems(problems)).toBe(false);
    }
  });

  it('«Новые» — десять писем, Вх-2026/108…117 без пропусков, следующий 118', () => {
    expect(demoLetters.filter((l) => boxOf(l) === 'new')).toHaveLength(10);
    const seqs = demoLetters
      .filter((l) => l.direction === 'incoming')
      .map((l) => Number(l.regNumber?.split('/')[1]))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    expect(seqs).toEqual([108, 109, 110, 111, 112, 113, 114, 115, 116, 117]);
    expect(nextLetterNumber('incoming', new Date(2026, 9, 26))).toBe('Вх-2026/118');
    // Исходящее Исх-2026/1 (демо #56) — цель связей «ответ на».
    const outgoing = demoLetters.filter((l) => l.direction === 'outgoing');
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]?.regNumber).toBe('Исх-2026/1');
    expect(nextLetterNumber('outgoing', new Date(2026, 9, 26))).toBe('Исх-2026/2');
  });

  it('почтовые письма #56: конверт, авто-связь, подсказки и флаги', () => {
    const bySubject = (part: string) => demoLetters.find((l) => l.subject?.includes(part))!;
    // Авто-связь по цепочке — бейдж очереди, подсказки в карточке нет.
    const reply = bySubject('RE: Договор-оферта');
    expect(reply.replyTo?.regNumber).toBe('Исх-2026/1');
    expect(letterDetailOf(reply, registrar).replySuggestion).toBeNull();
    // Подсказка по теме «на № 1 от …» — только пока связи нет.
    const dopusk = bySubject('О допуске');
    expect(dopusk.replyTo).toBeNull();
    expect(letterDetailOf(dopusk, registrar).replySuggestion?.regNumber).toBe('Исх-2026/1');
    // Подстановка контрагента: единственный контакт с адресом (Р6).
    expect(letterDetailOf(reply, registrar).counterpartySuggestion).toMatchObject({
      counterpartyId: expect.any(String),
      signerId: expect.any(String),
    });
    const noMatch = bySubject('Приглашение');
    expect(letterDetailOf(noMatch, registrar).counterpartySuggestion).toBeNull();
    // Флаги приёма: битое письмо и обрезанное хранение.
    expect(bySubject('Счёт на оплату').mail?.parseIssue).toBe(true);
    expect(bySubject('Коммерческое предложение').mail?.storageIncomplete).toBe(true);
    // Inline-картинка с contentId — в счётчик файлов не входит (Р9):
    // считаются тело и winmail.dat.
    const kp = bySubject('Коммерческое предложение');
    expect(kp.attachments.some((a) => a.inline && a.contentId === 'logo@psm-partner')).toBe(true);
    expect(letterListItemOf(kp).attachmentCount).toBe(2);
  });

  it('кнопки нового письма — только у держателя права регистрации', () => {
    const fresh = demoLetters.find((l) => boxOf(l) === 'new')!;
    const names = letterTransitionsOf(fresh, registrar).map((t) => t.name);
    expect(names).toEqual(['Зарегистрировать', 'Закрыть без регистрации']);
    expect(letterTransitionsOf(fresh, employee)).toEqual([]);
    expect(letterDetailOf(fresh, registrar).access.canDeleteSpam).toBe(true);
  });

  it('конфиденциальное письмо (#461, Р4): видно участникам, чужому — 404', () => {
    const secret = demoLetters.find((l) => l.regNumber === 'Вх-2026/115')!;
    expect(secret.confidential).toBe(true);
    const addressee = { id: userIds.klimovich, permissions: [] };
    const office = { id: userIds.karpovich, permissions: [Permission.CORRESPONDENCE_REGISTER] };
    expect(canSeeLetter(secret, addressee)).toBe(true);
    expect(canSeeLetter(secret, office)).toBe(true);
    expect(canSeeLetter(secret, employee)).toBe(false);
    // Бейдж и строки — только у видящих: элемент списка несёт флаг.
    expect(letterListItemOf(secret).confidential).toBe(true);
    // CRM-счётчик считается тем же правилом видимости (без +1 у чужого).
    const total = demoLetters.filter(
      (l) => l.registeredAt !== null && l.counterparty?.id === secret.counterparty?.id,
    ).length;
    expect(lettersCountOf(secret.counterparty!.id, employee)).toBe(total - 1);
    expect(lettersCountOf(secret.counterparty!.id, addressee)).toBe(total);
  });

  it('дерево «ёлочки» (#461, Р2): конверт раскрывает вложенное письмо', () => {
    const envelope = demoLetters.find((l) => l.regNumber === 'Вх-2026/115')!;
    const nested = demoLetters.find((l) => l.subject?.includes('О корректировке сроков'))!;
    // Канцелярия видит и конверт (регистратор), и незарегистрированное вложенное.
    const office = { id: userIds.karpovich, permissions: [Permission.CORRESPONDENCE_REGISTER] };
    expect(nested.nestedIn?.id).toBe(envelope.id);
    const tree = letterTreeOf(nested.id, office);
    expect(tree).not.toBeNull();
    expect(letterTreeResponseSchema.parse(tree)).toBeTruthy();
    expect(tree!.root.id).toBe(envelope.id);
    expect(tree!.root.children.map((child) => child.id)).toContain(nested.id);
    expect(tree!.root.children[0]?.relationKind).toBe('nested_in');
    expect(tree!.root.children[0]?.relationId).toBeTruthy();
    // Невидимое письмо — дерева нет (404 без оракула); чужой видит вложенное
    // письмо, но не конфиденциальный конверт: цепочка обрывается на нём.
    expect(letterTreeOf(envelope.id, employee)).toBeNull();
    expect(letterTreeOf(nested.id, employee)).toBeNull();
  });

  it('приложенные письма (#461, Р3): строки в карточке и поиск по номеру', () => {
    const envelope = demoLetters.find((l) => l.regNumber === 'Вх-2026/115')!;
    const detail = letterDetailOf(envelope, { id: userIds.klimovich, permissions: [] });
    expect(detail.attachedRefs.map((ref) => ref.number)).toEqual(['0359-КЖ/147', '78']);
    expect(detail.attachedRefs[1]?.orgText).toBe('Беларуськалий');
    expect(detail.canManageRelations).toBe(false);
    expect(
      letterDetailOf(envelope, {
        id: userIds.karpovich,
        permissions: [Permission.CORRESPONDENCE_REGISTER],
      }).canManageRelations,
    ).toBe(true);
  });

  it('ошибка схемы регистрации → поле и причина 422', () => {
    const parsed = executeTransitionBodySchema.safeParse({
      form: { registration: { counterpartyId: 'x' } },
    });
    expect(parsed.success).toBe(false);
    const issue = parsed.success
      ? null
      : registrationIssueOf(parsed.error, ['form', 'registration']);
    expect(issue?.field).toBe('counterpartyId');
  });
});
