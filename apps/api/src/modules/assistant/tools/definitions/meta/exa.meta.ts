import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания внешних инструментов Exa (#926). */
export const exaMeta = {
  'ext.exa.web_search_exa': {
    why: 'Найти свежие внешние сведения в интернете: нормы, цены, поставщиков и публикации.',
    whenToUse:
      '«Найди в интернете», «какие сейчас цены», «что нового по нормативам», «найди поставщика» — вопрос про данные ВНЕ портала.',
    whenNotToUse:
      'Не для данных портала (задачи, письма, проекты) и не для чтения конкретной найденной страницы (ext.exa.web_fetch_exa); текст писем в запрос не вставляй.',
    subject: 'ссылка',
    effect: 'external',
    example: {
      input: { query: 'нормативы смета 2026', numResults: 5 },
      note: 'поисковая строка без данных портала',
    },
    returns: 'Результаты со ссылками: название, адрес и фрагменты текста.',
    nextStep: 'Открой нужную ссылку через ext.exa.web_fetch_exa, чтобы прочитать страницу целиком.',
    intent: 'search',
  },
  'ext.exa.web_fetch_exa': {
    why: 'Прочитать страницу интернета по адресу и получить её текст в Markdown.',
    whenToUse:
      '«Открой эту ссылку», «прочитай страницу», «что написано на сайте» — адрес взят из результатов ext.exa.web_search_exa.',
    whenNotToUse:
      'Не для поиска (ext.exa.web_search_exa) и не для вложений портала (files.extract_text) — это внешние страницы.',
    subject: 'ссылка',
    effect: 'external',
    example: {
      input: { url: 'https://example.org/normativy' },
      note: 'адрес из результатов поиска',
    },
    returns: 'Полный текст страницы в Markdown, обрезанный по лимиту.',
    nextStep: 'Ответь по фактам страницы со ссылкой на источник.',
    intent: 'get',
  },
} satisfies Record<string, ToolStandard>;
