import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { MailParserService } from './mail-parser.service.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const parse = (name: string) => {
  const service = new MailParserService();
  return service.parse(createReadStream(join(FIXTURES, name)), async () => true);
};

/** Заголовок части сверх потолка mailsplit (1 МБ): парсер отдаёт error без end. */
const OVERSIZED_HEADER = 'a'.repeat(1_300_000);

describe('MailParserService: фикстуры приёма (#56, Р3)', () => {
  it('windows-1251: тема и тело в UTF-8, адрес и имя отправителя разобраны', async () => {
    const { mail } = await parse('win1251.eml');
    expect(mail!.messageId).toBe('kzh-zapros@galurgiya.by');
    expect(mail!.subject).toBe('Запрос чертежей КЖ этап 0359');
    expect(mail!.text).toContain('чертежи марки КЖ');
    expect(mail!.fromAddress).toBe('a.lukashevich@galurgiya.by');
    expect(mail!.fromName).toBe('Лукашевич Анна Викторовна');
  });

  it('koi8-r: декодирование тела', async () => {
    const { mail } = await parse('koi8-r.eml');
    expect(mail!.subject).toBe('График поставки оборудования');
    expect(mail!.text).toContain('график поставки на ноябрь');
  });

  it('ответ с цепочкой: In-Reply-To, References от старых к новым, inline-лого с contentId, подпись', async () => {
    const { mail } = await parse('reply-cid.eml');
    expect(mail!.inReplyTo).toBe('out-1@passat.by');
    expect(mail!.references).toEqual(['old-thread@passat.by', 'out-1@passat.by']);
    expect(mail!.html).toContain('cid:logo@psm-partner');
    const logo = mail!.attachments.find((a) => a.contentId === 'logo@psm-partner');
    expect(logo?.inline).toBe(true);
    expect(logo?.filename).toBe('лого.png');
    const signature = mail!.attachments.find((a) => a.filename.endsWith('.p7s'));
    expect(signature?.inline).toBe(false);
    expect(signature?.mime).toBe('application/pkcs7-signature');
  });

  it('письмо без темы: subject null; без Message-ID: messageId null', async () => {
    const noSubject = (await parse('no-subject.eml')).mail;
    expect(noSubject!.subject).toBeNull();
    const noId = (await parse('no-message-id.eml')).mail;
    expect(noId!.messageId).toBeNull();
    expect(noId!.subject).toBe('Без идентификатора');
  });

  it('References длиннее списка парсится целиком — кап применяет threading (Р5)', async () => {
    const { mail } = await parse('references-110.eml');
    expect(mail!.references).toHaveLength(110);
  });

  it('51 вложение: все разобраны — лимит хранения применяет писатель (Р12)', async () => {
    const { mail } = await parse('attachments-51.eml');
    expect(mail!.attachments).toHaveLength(51);
    expect(mail!.attachments[0]!.filename).toBe('файл-00.txt');
  });

  it('winmail.dat — вложение с меткой Outlook (TNEF не распаковываем, O4)', async () => {
    const { mail } = await parse('winmail-attachment.eml');
    const winmail = mail!.attachments.find((a) => a.filename === 'winmail.dat');
    expect(winmail?.mime).toBe('application/ms-tnef');
  });

  it('дедуп по заголовкам: onHeaders → false рвёт разбор до вложений', async () => {
    const service = new MailParserService();
    const outcome = await service.parse(
      createReadStream(join(FIXTURES, 'attachments-51.eml')),
      async () => false,
    );
    expect(outcome.skipped).toBe(true);
    expect(outcome.mail).toBeNull();
  });
});

describe('MailParserService: битый вход не держит разбор (AUD-019)', () => {
  it('ошибка парсера до заголовков завершает разбор с parseIssue', async () => {
    const raw = Buffer.from(`From: a@b.c\r\nSubject: ${OVERSIZED_HEADER}\r\n\r\nтело`);
    const service = new MailParserService();
    const outcome = await service.parse(Readable.from([raw]), async () => true);
    expect(outcome.skipped).toBe(false);
    expect(outcome.mail!.parseIssue).toBe(true);
  });

  it('ошибка парсера после заголовков отдаёт разобранное, не дожидаясь end', async () => {
    const raw = Buffer.from(
      'From: a@b.c\r\nSubject: ok\r\nContent-Type: multipart/mixed; boundary="B"\r\n\r\n' +
        `--B\r\nContent-Type: text/plain\r\nX-Big: ${OVERSIZED_HEADER}\r\n\r\nhi\r\n--B--`,
    );
    const service = new MailParserService();
    const outcome = await service.parse(Readable.from([raw]), async () => true);
    expect(outcome.skipped).toBe(false);
    expect(outcome.mail!.subject).toBe('ok');
    expect(outcome.mail!.parseIssue).toBe(true);
  });

  it('обрезанный вход: общий таймаут разбора завершает поток с parseIssue', async () => {
    const stalled = new Readable({ read() {} });
    stalled.push('From: a@b.c\r\nSubject: обрезано');
    const service = new MailParserService();
    const outcome = await service.parse(stalled, async () => true, 50);
    expect(outcome.skipped).toBe(false);
    expect(outcome.mail!.parseIssue).toBe(true);
  });
});
