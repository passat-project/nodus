import { describe, expect, it } from 'vitest';

import { sendMessageBodySchema } from './chat.schemas.js';

/** Переименование вложений при отправке (#146): имя, выбранное в окне
 *  отправки уже после загрузки, применяется транзакцией claim. Схема обязана
 *  пускать только имена для отправляемых ids — иначе клиент мог бы назвать
 *  чужую/непривязанную строку. */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('sendMessageBodySchema: переименования вложений (#146)', () => {
  it('принимает имя для отправляемого вложения (trim)', () => {
    const parsed = sendMessageBodySchema.parse({
      text: '',
      attachmentIds: [A],
      attachmentRenames: [{ id: A, name: '  Смета на согласование.pdf  ' }],
    });
    expect(parsed.attachmentRenames).toEqual([{ id: A, name: 'Смета на согласование.pdf' }]);
  });

  it('renames без attachmentIds — ошибка', () => {
    expect(() =>
      sendMessageBodySchema.parse({
        text: 'Файл',
        attachmentRenames: [{ id: A, name: 'имя.pdf' }],
      }),
    ).toThrow();
  });

  it('renames на id вне attachmentIds — ошибка', () => {
    expect(() =>
      sendMessageBodySchema.parse({
        text: '',
        attachmentIds: [A],
        attachmentRenames: [{ id: B, name: 'имя.pdf' }],
      }),
    ).toThrow();
  });

  it('дубликат id в renames — ошибка', () => {
    expect(() =>
      sendMessageBodySchema.parse({
        text: '',
        attachmentIds: [A],
        attachmentRenames: [
          { id: A, name: 'первое.pdf' },
          { id: A, name: 'второе.pdf' },
        ],
      }),
    ).toThrow();
  });

  it('пустое имя после trim — ошибка', () => {
    expect(() =>
      sendMessageBodySchema.parse({
        text: '',
        attachmentIds: [A],
        attachmentRenames: [{ id: A, name: '   ' }],
      }),
    ).toThrow();
  });
});
