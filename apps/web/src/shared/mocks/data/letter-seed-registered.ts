// I5-обоснование: спецификации зарегистрированных писем (данные демо-мира
// #55) — отдельный файл от «Новых»: журнал Вх-2026/108…117 меняется реже.
import type { TaskStage } from '@nodus/contracts';

import { contactIds, counterpartyIds } from './counterparties.js';
import { fieldIds } from './field-ids.js';
import { receiptMethodIds } from './dictionaries.js';
import { letterStages } from './letter-catalog.js';
import type { DemoLetter } from './letters-model.js';
import { userIds } from './users.js';

export interface RegisteredLetter {
  n: number;
  seq: number;
  days: number;
  at: [number, number];
  counterparty: string;
  signer?: string;
  theirNumber: string;
  theirDate: string;
  subject: string;
  method: string;
  project?: boolean;
  addressee: string;
  deadline?: number;
  participants?: string[];
  customFields?: DemoLetter['customFields'];
  stage?: TaskStage;
  /** «Конфиденциально» (#461): демо — Вх-2026/115 виден участникам. */
  confidential?: boolean;
  /** Строки «приложенных писем» (#461): конверт-матрёшка на бумаге. */
  attachedRefs?: { number: string; counterparty: string; date?: string }[];
}

const replyRequired = { [fieldIds.letterReplyRequired]: true };
const { galurgiya, stroyzakazchik, minstroy, tehssnab, promstroymontazh } = counterpartyIds;

/** Зарегистрированные входящие: Вх-2026/108…117, одно «ошибочно». */
export const registeredLetterSpecs: RegisteredLetter[] = [
  {
    n: 10,
    seq: 117,
    days: 1,
    at: [16, 5],
    counterparty: galurgiya,
    theirNumber: '0359/203',
    theirDate: '2026-10-24',
    subject: 'Приглашение на приёмку этапа 0359-1',
    method: receiptMethodIds.email,
    project: true,
    addressee: userIds.klimovich,
    deadline: 6,
    customFields: { [fieldIds.letterObjectCode]: '0359-1' },
  },
  {
    n: 9,
    seq: 116,
    days: 2,
    at: [10, 30],
    counterparty: stroyzakazchik,
    signer: contactIds.sidorenko,
    theirNumber: '131/10',
    theirDate: '2026-10-23',
    subject: 'О продлении срока действия договора № 14/2026',
    method: receiptMethodIds.courier,
    addressee: userIds.shaiderova,
    deadline: 10,
    customFields: replyRequired,
  },
  {
    n: 3,
    seq: 115,
    days: 4,
    at: [11, 45],
    counterparty: galurgiya,
    signer: contactIds.petrov,
    theirNumber: '0359-КЖ/147',
    theirDate: '2026-10-20',
    subject: 'Замечания по разделу КЖ главного корпуса (этап 0359)',
    method: receiptMethodIds.email,
    project: true,
    addressee: userIds.klimovich,
    deadline: -1,
    participants: [userIds.vinnichek, userIds.matorin],
    customFields: { [fieldIds.letterObjectCode]: '0359', ...replyRequired },
    // Демо конфиденциальности (#461): «Замечания по КЖ» видит адресат
    // (Климович), регистратор, участники и держатели права — остальным
    // строки в списках нет, карточка 404.
    confidential: true,
    // Конверт-матрёшка: заказчик прислал пачку писем вложением — строки
    // «№ + организация + дата»; поиск по «78» находит это письмо.
    attachedRefs: [
      { number: '0359-КЖ/147', counterparty: galurgiya, date: '2026-10-20' },
      { number: '78', counterparty: galurgiya, date: '2026-10-18' },
    ],
  },
  {
    n: 8,
    seq: 114,
    days: 4,
    at: [9, 10],
    counterparty: minstroy,
    theirNumber: '04-3-15/3790',
    theirDate: '2026-10-21',
    subject: 'О применении технических нормативных правовых актов с 01.01.2027',
    method: receiptMethodIds.smdo,
    addressee: userIds.shaiderova,
  },
  {
    n: 7,
    seq: 113,
    days: 5,
    at: [15, 30],
    counterparty: promstroymontazh,
    signer: contactIds.melnik,
    theirNumber: 'ПСМ-09/77',
    theirDate: '2026-10-20',
    subject: 'О графике монтажа металлоконструкций (этап 0359)',
    method: receiptMethodIds.email,
    project: true,
    addressee: userIds.matorin,
    deadline: 4,
    participants: [userIds.klimovich],
    customFields: { [fieldIds.letterObjectCode]: '0359' },
  },
  {
    n: 6,
    seq: 112,
    days: 5,
    at: [10, 0],
    counterparty: promstroymontazh,
    theirNumber: '418',
    theirDate: '2026-10-20',
    subject: 'Счёт-фактура № 418 за сентябрь 2026 года',
    method: receiptMethodIds.post,
    addressee: userIds.klimovich,
    stage: letterStages.registeredByMistake,
  },
  {
    n: 5,
    seq: 111,
    days: 6,
    at: [14, 20],
    counterparty: galurgiya,
    signer: contactIds.petrov,
    theirNumber: '0359-ОВ/61',
    theirDate: '2026-10-19',
    subject: 'О предоставлении исходных данных для раздела ОВ',
    method: receiptMethodIds.post,
    project: true,
    addressee: userIds.vinnichek,
    deadline: 2,
    customFields: { [fieldIds.letterObjectCode]: '0359', ...replyRequired },
  },
  {
    n: 4,
    seq: 110,
    days: 7,
    at: [11, 15],
    counterparty: tehssnab,
    signer: contactIds.zhukov,
    theirNumber: 'ТС-09/214',
    theirDate: '2026-10-18',
    subject: 'Коммерческое предложение по вентиляционному оборудованию',
    method: receiptMethodIds.email,
    project: true,
    addressee: userIds.vinnichek,
  },
  {
    n: 2,
    seq: 109,
    days: 7,
    at: [9, 40],
    counterparty: stroyzakazchik,
    signer: contactIds.sidorenko,
    theirNumber: '118/09',
    theirDate: '2026-10-18',
    subject: 'О согласовании изменений в проектную документацию (корпус Б)',
    method: receiptMethodIds.email,
    addressee: userIds.klimovich,
    deadline: 3,
    participants: [userIds.vinnichek],
    customFields: replyRequired,
  },
  {
    n: 1,
    seq: 108,
    days: 8,
    at: [10, 5],
    counterparty: minstroy,
    theirNumber: '04-1-09/3512',
    theirDate: '2026-10-17',
    subject: 'О проведении плановой проверки проектной организации',
    method: receiptMethodIds.smdo,
    addressee: userIds.shaiderova,
    deadline: 5,
    customFields: replyRequired,
  },
];
