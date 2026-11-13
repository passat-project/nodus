import { describe, expect, it } from 'vitest';
import type { MessageAttachment } from '@nodus/contracts';

import { restoreFailedIntoDraft } from './draft-restore.js';
import { EMPTY_DRAFT, type ChatDraft } from './chat-drafts.js';

/** Чистая логика возврата упавшей отправки (#248): ветки занятого/пустого
 *  поля без стора — детерминированные фикстуры. */

const attDto: MessageAttachment = {
  id: 'att-1',
  fileId: 'file-1',
  name: 'отчёт.csv',
  size: 10,
  mime: 'text/csv',
  kind: 'file',
  url: null,
  thumbnailUrl: null,
  previewKind: 'file',
  pdfUrl: null,
  width: null,
  height: null,
};

const draft = (patch: Partial<ChatDraft> = {}): ChatDraft => ({
  ...EMPTY_DRAFT,
  ...patch,
});

describe('restoreFailedIntoDraft (#248)', () => {
  it('пустое поле: wire без токенов → текст как есть, вложения строками окна', () => {
    const out = restoreFailedIntoDraft(draft(), {
      wireText: 'просто текст',
      reply: null,
      urgent: false,
      attachments: [attDto],
    });
    expect(out.text).toBe('просто текст');
    expect(out.mentions).toEqual([]);
    expect(out.attachments[0]).toMatchObject({
      localId: 'att-1',
      status: 'ready',
      progress: 1,
      objectUrl: null,
    });
  });

  it('переименование окна (#146): fileName восстанавливается, attachment — серверное имя', () => {
    // Иначе повтор отправки не увидел бы diff имён и сервер остался бы
    // со старым именем (кейс code-review #146).
    const out = restoreFailedIntoDraft(draft(), {
      wireText: '',
      reply: null,
      urgent: false,
      attachments: [attDto],
      attachmentRenames: [{ id: 'att-1', name: 'Смета на согласование.csv' }],
    });
    expect(out.attachments[0]).toMatchObject({
      fileName: 'Смета на согласование.csv',
      attachment: { id: 'att-1', name: 'отчёт.csv' },
    });
  });

  it('занятое поле, упавшая без текста: только конкат вложений, текст не тронут', () => {
    const out = restoreFailedIntoDraft(
      draft({ text: 'набираю', mentions: [{ start: 0, end: 6, id: 'u1', label: 'набирa' }] }),
      { wireText: '', reply: null, urgent: false, attachments: [attDto] },
    );
    expect(out.text).toBe('набираю');
    expect(out.mentions).toEqual([{ start: 0, end: 6, id: 'u1', label: 'набирa' }]);
    expect(out.attachments.map((a) => a.localId)).toEqual(['att-1']);
  });

  it('пустое поле: контекст, начатый за полёт, не затирается (ответ), молния дополняется', () => {
    const out = restoreFailedIntoDraft(
      draft({
        reply: {
          messageId: 'new',
          author: { id: 'a2', displayName: 'Новый', avatarUrl: null },
          snippet: 'новый',
          quoteText: null,
          attachmentKind: null,
          stickerUrl: null,
          stickerEmoji: null,
          stickerMime: null,
          inThread: null,
        },
        urgent: true,
      }),
      {
        wireText: 'упавшее',
        reply: {
          id: 'old',
          author: { id: 'a1', displayName: 'Старый', avatarUrl: null },
          text: 'старый',
          quoteText: null,
          attachmentKind: null,
          deleted: false,
          obliterated: false,
        },
        urgent: false,
        attachments: [],
      },
    );
    // Ответ пользователя (за полёт) приоритетнее упавшего; молния — OR.
    expect(out.reply?.messageId).toBe('new');
    expect(out.urgent).toBe(true);
    expect(out.text).toBe('упавшее');
  });

  it('занятое поле: вложения упавшей стоят раньше начатых за полёт', () => {
    const mine = draft({
      text: 'набираю',
      attachments: [
        {
          localId: 'mine',
          fileName: 'моё',
          mime: 'text/csv',
          size: 1,
          progress: 1,
          status: 'ready',
          attachment: attDto,
          objectUrl: null,
        },
      ],
    });
    const out = restoreFailedIntoDraft(mine, {
      wireText: 'упавшее',
      reply: null,
      urgent: false,
      attachments: [attDto],
    });
    expect(out.attachments.map((a) => a.localId)).toEqual(['att-1', 'mine']);
    expect(out.text).toBe('упавшее\nнабираю');
  });
});
