import { Injectable } from '@nestjs/common';
import { MailParser } from 'mailparser';
import type { Readable } from 'node:stream';

import { LETTER_LIMITS } from '@nodus/contracts';

/** Разобранное вложение: имя декодировано (кириллица корректна — libmime
 *  внутри mailparser), contentId — без угловых скобок, inline — картинка
 *  HTML-тела (related/Content-Disposition). */
export interface ParsedMailAttachment {
  filename: string;
  mime: string;
  contentId: string | null;
  inline: boolean;
  content: Buffer;
}

export interface ParsedMail {
  messageId: string | null;
  inReplyTo: string | null;
  /** References от старых к новым (как в письме); кап — сервис. */
  references: string[];
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  /** Тело в нормализованном UTF-8 (html приоритет при показе). */
  html: string | null;
  text: string | null;
  attachments: ParsedMailAttachment[];
  /** Разбор не дошёл до конца — реквизиты и файлы неполные (анти-яд). */
  parseIssue: boolean;
}

export interface ParseOutcome {
  /** true — дубль по Message-ID: обработка остановлена до вложений. */
  skipped: boolean;
  mail: ParsedMail | null;
}

/** Потолок разбора одного письма (AUD-019): битый вход не держит цикл приёма
 *  вечно — по таймауту отдаём разобранное с флагом parseIssue. */
const PARSE_TIMEOUT_MS = 30_000;

const messageIdOf = (value: unknown): string | null => {
  // mailparser отдаёт msg-id списки массивом (References), одиночные — строкой;
  // угловые скобки снимаем: единый «голый» ID для колонки, дедупа и цепочек.
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  return raw.trim().replace(/^<|>$/g, '') || null;
};

/** References (RFC 5256): mailparser отдаёт массив «<id>» (или строку) —
 *  разбираем в список ID без угловых скобок, от старых к новым. */
const referencesOf = (value: unknown): string[] => {
  const parts = Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : [];
  return parts.flatMap((part) =>
    (part.match(/<([^>]+)>/g) ?? []).map((match) => match.slice(1, -1)),
  );
};

const addressOf = (value: unknown): { address: string | null; name: string | null } => {
  const structured = value as { value?: { address?: string; name?: string }[] } | undefined;
  const first = Array.isArray(structured?.value) ? structured?.value[0] : undefined;
  return {
    address: typeof first?.address === 'string' ? first.address.trim() || null : null,
    name: typeof first?.name === 'string' && first.name.trim() ? first.name.trim() : null,
  };
};

/**
 * Разбор исходника письма (#56, Р3): событийный MailParser — заголовки
 * приходят РАНЬШЕ стримов вложений, поэтому дедуп по Message-ID (хук
 * `onHeaders`) срабатывает до того, как что-либо записано в хранилище.
 * Кодировки (windows-1251, koi8-r) декодируются в UTF-8 самим mailparser.
 * Вложения буферизуются (потолок сообщения режет сам почтовый сервер;
 * .eml сверх потолка хранилища не сохраняется — флаг, не потеря письма).
 */
@Injectable()
export class MailParserService {
  parse(
    raw: Readable,
    onHeaders: (messageId: string | null) => Promise<boolean>,
    timeoutMs: number = PARSE_TIMEOUT_MS,
  ): Promise<ParseOutcome> {
    return new Promise((resolve) => {
      const parser = new MailParser();
      const mail: ParsedMail = {
        messageId: null,
        inReplyTo: null,
        references: [],
        fromAddress: null,
        fromName: null,
        subject: null,
        html: null,
        text: null,
        attachments: [],
        parseIssue: false,
      };
      let html = '';
      let text = '';
      let settled = false;
      let headersSeen = false;
      // Гейт дедупа: 'end' короткого письма обгоняет async-проверку по базе
      // (всё сообщение уже в буфере парсера, пауза источника не помогает) —
      // поэтому завершение разбора ЖДЁТ решения по заголовкам.
      let resolveDecision!: (continueParsing: boolean) => void;
      const decided = new Promise<boolean>((resolve) => {
        resolveDecision = resolve;
      });

      // Общий таймаут одного письма: битый вход не держит разбор вечно.
      const timer = setTimeout(() => {
        mail.parseIssue = true;
        raw.destroy();
        parser.destroy();
        finish({ skipped: false, mail });
      }, timeoutMs);

      const finish = (outcome: ParseOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };

      parser.on('headers', (headers) => {
        headersSeen = true;
        mail.messageId = messageIdOf(headers.get('message-id'));
        mail.inReplyTo = messageIdOf(headers.get('in-reply-to'));
        mail.references = referencesOf(headers.get('references'));
        const from = addressOf(headers.get('from'));
        mail.fromAddress = from.address;
        mail.fromName = from.name;
        const subject = headers.get('subject');
        mail.subject =
          typeof subject === 'string' && subject.trim()
            ? subject.trim().slice(0, LETTER_LIMITS.subject)
            : null;
        onHeaders(mail.messageId)
          .then((continueParsing) => {
            resolveDecision(continueParsing);
            if (!continueParsing) {
              // Дубль: рвём и парсер, и исходный стрим — вложения не читаем.
              raw.destroy();
              parser.destroy();
              finish({ skipped: true, mail: null });
            }
          })
          .catch(() => resolveDecision(true));
      });

      parser.on('data', (data) => {
        if (data.type === 'text') {
          if (typeof data.html === 'string') html += data.html;
          if (typeof data.text === 'string') text += data.text;
        } else if (data.type === 'attachment') {
          const chunks: Buffer[] = [];
          data.content.on('data', (chunk: Buffer) => chunks.push(chunk));
          data.content.on('end', () => {
            mail.attachments.push({
              filename: data.filename || 'файл',
              mime: (data.contentType || 'application/octet-stream').split(';')[0]!.trim(),
              contentId: data.cid?.replace(/^<|>$/g, '') ?? null,
              inline: data.related || data.contentDisposition === 'inline',
              content: Buffer.concat(chunks),
            });
            // release() обязателен — без него парсер не продолжит (канон
            // mailparser: освобождаем сразу по концу содержимого).
            data.release?.();
          });
        }
      });

      parser.on('error', () => {
        // Битое письмо не блокирует очередь: отдаём то, что успело разобраться.
        mail.parseIssue = true;
        if (!headersSeen) {
          // Заголовки не пришли — ждать решение дедупа не на чем.
          finish({ skipped: false, mail });
          return;
        }
        // Заголовки уже есть: не обходим проверку Message-ID дубля-письма.
        void decided.then((continueParsing) => {
          if (continueParsing) finish({ skipped: false, mail });
        });
      });

      parser.on('end', () => {
        void decided.then((continueParsing) => {
          if (!continueParsing) return;
          mail.html = html.length > 0 ? html : null;
          mail.text = text.length > 0 ? text : null;
          finish({ skipped: false, mail });
        });
      });

      raw.on('error', () => {
        mail.parseIssue = true;
        finish({ skipped: false, mail });
      });

      raw.pipe(parser);
    });
  }
}
