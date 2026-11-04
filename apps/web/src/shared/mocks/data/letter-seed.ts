// I5-обоснование: плоский мок-набор писем (данные, не god-object) — одна
// ответственность «демо-мир корреспонденции»; журнал — letter-history-seed.ts.
import type { ContactRef, CounterpartyRef, LetterRef, ReceiptMethodRef } from '@nodus/contracts';

import { demoCounterpartyById } from './counterparties.js';
import { isoAgo, isoDateIn } from './dates.js';
import { itemById } from './dictionaries.js';
import { incomingLetterType, outgoingLetterType, letterStages } from './letter-catalog.js';
import {
  kzh147Extra,
  mailLetterFiles as mf,
  newLetterFiles as f,
  registeredMain,
} from './letter-files.js';
import { lid } from './letter-ids.js';
import type { DemoLetter } from './letters-model.js';
import { registeredLetterSpecs, type RegisteredLetter } from './letter-seed-registered.js';
import { projectRefs } from './task-item-factory.js';
import { userIds, userRef } from './users.js';

/** Мир писем (#55, §7.6): «Новые» — шесть видов поступления (HTML с
 *  внешними картинками и скриптом, PDF + текст, docx, скан без темы, только
 *  текст, многостраничный PDF) + почтовые виды #56 (ответ с авто-связью и
 *  подписью .p7s, «на № N от…» с подсказкой, КП с cid-логотипом и
 *  winmail.dat, битое без тела); зарегистрированные входящие Вх-2026/108…117
 *  (следующий — 118), одно «Ошибочно зарегистрировано» с причиной в чате;
 *  исходящее Исх-2026/1 (отправлено — цель связей «ответ на»). Даты
 *  документов — даты ассетов, регистрация — от «сейчас». */

function cp(id: string): CounterpartyRef {
  const found = demoCounterpartyById(id);
  if (!found) throw new Error(`Неизвестный демо-контрагент: ${id}`);
  return { id: found.id, name: found.shortName };
}

function signer(counterpartyId: string, contactId: string): ContactRef {
  const person = demoCounterpartyById(counterpartyId)?.contactPersons.find(
    (c) => c.id === contactId,
  );
  if (!person) throw new Error(`Неизвестный контакт: ${contactId}`);
  return { id: person.id, fullName: person.fullName, position: person.position };
}

function method(id: string): ReceiptMethodRef {
  const item = itemById(id);
  if (!item) throw new Error(`Неизвестный способ поступления: ${id}`);
  return { id: item.id, name: item.name };
}

const minutesAgo = (m: number): string => new Date(Date.now() - m * 60_000).toISOString();

const base = {
  direction: 'incoming' as const,
  signer: null,
  registrar: null,
  nestedIn: null,
  attachedRefs: [],
  confidential: false,
  regNumber: null,
  regDate: null,
  registeredAt: null,
  counterparty: null,
  theirNumber: null,
  theirDate: null,
  receiptMethod: null,
  project: null,
  addressee: null,
  responseDeadline: null,
  mail: null,
  replyTo: null,
  replySuggestion: null,
  customFields: {},
  participantIds: [],
  createdById: null,
};

/** Конверт почты (#56): адрес/имя отправителя, Message-ID, флаги приёма. */
function envelope(fromName: string | null, fromAddress: string, messageId: string) {
  return {
    fromName,
    fromAddress,
    messageId,
    parseIssue: false,
    storageIncomplete: false,
    bodyPdfIssue: false,
  };
}

function fresh(
  n: number,
  receivedAt: string,
  subject: string | null,
  attachments: DemoLetter['attachments'],
  mail: DemoLetter['mail'] = null,
  extra: Partial<DemoLetter> = {},
): DemoLetter {
  const main = attachments.find((a) => a.role === 'main' || a.role === 'body_pdf');
  return {
    ...base,
    id: lid(n),
    typeId: incomingLetterType.id,
    stage: letterStages.new,
    receivedAt,
    source: mail ? 'mail' : 'manual',
    subject,
    attachments,
    body: main ? { kind: 'document', attachmentId: main.id } : { kind: 'none' },
    createdById: mail ? null : userIds.karpovich,
    mail,
    ...extra,
  };
}

/** Конверт зарегистрированного письма: адрес — контакт контрагента (для
 *  подстановки Р6), без контакта — служебный домен демо-мира. */
function envelopeOfCounterparty(counterpartyId: string, messageId: string): DemoLetter['mail'] {
  const card = demoCounterpartyById(counterpartyId);
  const person = card?.contactPersons.find((p) => !p.archivedAt && p.email);
  return envelope(
    person?.fullName ?? card?.shortName ?? null,
    person?.email ?? `pochta@${card?.unp ?? 'demo'}.demo`,
    messageId,
  );
}

function registered(o: RegisteredLetter): DemoLetter {
  const main = registeredMain[o.n];
  if (!main) throw new Error(`Нет документа письма lid(${o.n})`);
  const attachments = o.n === 3 ? [main, ...kzh147Extra] : [main];
  return {
    ...base,
    id: lid(o.n),
    typeId: incomingLetterType.id,
    stage: o.stage ?? letterStages.onResolution,
    regNumber: `Вх-2026/${o.seq}`,
    regDate: isoDateIn(-o.days),
    registeredAt: isoAgo(o.days, o.at[0], o.at[1]),
    receivedAt: isoAgo(o.days, o.at[0] - 1, o.at[1]),
    source: 'mail',
    subject: o.subject,
    counterparty: cp(o.counterparty),
    signer: o.signer ? signer(o.counterparty, o.signer) : null,
    theirNumber: o.theirNumber,
    theirDate: o.theirDate,
    receiptMethod: method(o.method),
    project: o.project ? projectRefs.p4 : null,
    addressee: userRef(o.addressee),
    responseDeadline: o.deadline === undefined ? null : isoDateIn(o.deadline),
    registrar: userRef(userIds.karpovich),
    attachments,
    body: { kind: 'document', attachmentId: main.id },
    customFields: o.customFields ?? {},
    participantIds: o.participants ?? [],
    mail: envelopeOfCounterparty(o.counterparty, `<reg-${o.n}@demo>`),
    confidential: o.confidential ?? false,
    attachedRefs: (o.attachedRefs ?? []).map((ref) => ({
      id: crypto.randomUUID(),
      number: ref.number,
      counterparty: cp(ref.counterparty!),
      date: ref.date ?? null,
    })),
  };
}

/** Исходящее Исх-2026/1 (демо #56): цель авто-связи и подсказок «ответ на». */
function outgoingOffer(): DemoLetter {
  return {
    ...base,
    id: lid(30),
    direction: 'outgoing',
    typeId: outgoingLetterType.id,
    stage: letterStages.sent,
    regNumber: 'Исх-2026/1',
    regDate: isoDateIn(-4),
    registeredAt: isoAgo(4, 10, 30),
    receivedAt: isoAgo(4, 10, 30),
    source: 'manual',
    subject: 'Договор-оферта на проектирование корпуса Б',
    attachments: [mf.outgoingOffer],
    body: { kind: 'document', attachmentId: mf.outgoingOffer.id },
    mail: envelope('Канцелярия Пассат', 'chancery@passat.by', '<out-1@passat.by>'),
  };
}

const outgoingRef = (): LetterRef => {
  const letter = outgoingOffer();
  return { id: letter.id, regNumber: letter.regNumber, subject: letter.subject };
};

export function seedLetters(): DemoLetter[] {
  return [
    fresh(
      21,
      minutesAgo(18),
      'О корректировке сроков выдачи раздела КЖ (этап 0359)',
      [f.galurgiyaPdf, f.galurgiyaText],
      envelope('Лукашевич Анна Викторовна', 'a.lukashevich@galurgiya.by', '<kzh-152@galurgiya.by>'),
      // Матрёшка (#461): письмо лежит в конверте зарегистрированного
      // Вх-2026/115 (тот же этап и корреспондент) — «вложено в» ставит
      // канцелярия; в «ёлочке» конверт раскрывается шевроном.
      {
        nestedIn: {
          id: lid(3),
          regNumber: 'Вх-2026/115',
          subject: 'Замечания по разделу КЖ главного корпуса (этап 0359)',
        },
      },
    ),
    fresh(
      22,
      minutesAgo(47),
      'Приглашение на техническое совещание по корпусу Б',
      [f.inviteHtml, f.invitePlan],
      envelope(
        'Гончарова Марина Игоревна',
        'm.goncharova@stroyzakazchik.by',
        '<invite-77@stroyzakazchik.by>',
      ),
    ),
    fresh(
      23,
      isoAgo(1, 16, 40),
      'Запрос сведений о ходе проектирования объектов 2026 года',
      [f.minstroyDocx, f.minstroyText],
      envelope('Управление проектирования', 'design@mas.gov.by', '<3871@mas.gov.by>'),
    ),
    fresh(24, isoAgo(1, 11, 5), null, [f.scanJpg]),
    fresh(
      25,
      isoAgo(2, 15, 20),
      'Уточнение по договору поставки вентиляционного оборудования',
      [f.tehsnabText],
      envelope('Жуков Сергей Андреевич', 's.zhukov@tehsnab.by', '<utochnenie@tehsnab.by>'),
    ),
    fresh(
      26,
      isoAgo(3, 10, 0),
      'График монтажа металлоконструкций, редакция 2 (этап 0359)',
      [f.psmPdf],
      envelope(null, 'info@psm.by', '<grafik-r2@psm.by>'),
    ),
    // Почтовые виды #56: авто-связь + подпись, подсказка «на № 1», cid-КП +
    // winmail.dat с обрезанным хранением, битое письмо без тела.
    fresh(
      27,
      minutesAgo(6),
      'RE: Договор-оферта на проектирование корпуса Б',
      [mf.replyBody, mf.replySignature],
      envelope(
        'Лукашевич Анна Викторовна',
        'a.lukashevich@galurgiya.by',
        '<reply-offer@galurgiya.by>',
      ),
      {
        replyTo: outgoingRef(),
      },
    ),
    fresh(
      28,
      minutesAgo(32),
      'О допуске на объект — на № 1 от 24.10.2026',
      [mf.dopuskBody],
      envelope('Лукашевич Анна Викторовна', 'a.lukashevich@galurgiya.by', '<dopusk@galurgiya.by>'),
      {
        replySuggestion: outgoingRef(),
      },
    ),
    fresh(
      29,
      isoAgo(1, 9, 15),
      'Коммерческое предложение: металлоконструкции корпуса Б',
      [mf.partnerHtml, mf.partnerLogo, mf.partnerWinmail],
      {
        ...envelope('Жуков Сергей Андреевич', 's.zhukov@tehsnab.by', '<kp-mk@tehsnab.by>'),
        storageIncomplete: true,
      },
    ),
    fresh(31, isoAgo(2, 12, 10), 'Счёт на оплату услуг за октябрь', [], {
      ...envelope('Бухгалтерия ПСМ', 'buh@psm.by', '<schet-10@psm.by>'),
      parseIssue: true,
    }),
    outgoingOffer(),
    ...registeredLetterSpecs.map(registered),
  ];
}
