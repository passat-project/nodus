import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания инструментов вложений (#926). */
export const filesMeta = {
  'files.extract_text': {
    why: 'Прочитать текст вложенного PDF или DOCX по fileId, чтобы ответить по содержанию документа.',
    whenToUse:
      '«Прочитай, что в приложенном акте», «прочитай документ из вложения», «что написано в смете/договоре», «покажи текст файла».',
    whenNotToUse:
      'Не для описи вложений и имён файлов (letters.attachments) и не для сканов без текстового слоя — они не читаются.',
    subject: 'файл',
    effect: 'read',
    example: {
      input: { fileId: '9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f' },
      note: 'fileId из letters.attachments или из сообщения чата',
    },
    returns: 'Текст по страницам; страницы без текстового слоя помечены отдельно.',
    nextStep:
      'Со ссылкой на файл и страницу ответь по содержанию; для описи — letters.attachments.',
    intent: 'get',
  },
} satisfies Record<string, ToolStandard>;
