/**
 * Таблица офисных форматов ONLYOFFICE Docs (#138) — ЕДИНАЯ точка решений
 * «расширение → чем открывать» для web-реестра просмотрщика и API-сессий
 * (урок одной точки решений: формат не классифицируется по хостам рендера).
 *
 * Источник — официальные таблицы форматов ONLYOFFICE Docs 9.4
 * (api.onlyoffice.com/docs/docs-api/usage-api/config/document/ — списки
 * fileType; /get-started/how-it-works/opening-file/ — нативные форматы и
 * конвертация). PDF сюда НЕ входит: PDF открывается pdf.js без сессии
 * (спека #138). Диаграммы (vsdx) и mobi (выпущен из 9.x) не включены.
 */
export const OFFICE_DOCUMENT_TYPES = ['word', 'cell', 'slide', 'pdf'] as const;
export type OfficeDocumentType = (typeof OFFICE_DOCUMENT_TYPES)[number];

export interface OfficeFormatInfo {
  documentType: OfficeDocumentType;
  /** Редактирование поддерживается DS. Нативные форматы (docx/xlsx/pptx)
   *  правятся напрямую; остальные — вход через конвертацию в OOXML, обратное
   *  сохранение в исходный формат (legacy .doc может откатиться в .docx —
   *  поведение DS, документировано). */
  editable: boolean;
}

/** Форматы, открываемые в ONLYOFFICE в режиме просмотра. */
export const OFFICE_VIEW_FORMATS: Readonly<Record<string, OfficeFormatInfo>> = {
  // Текстовые (word)
  doc: { documentType: 'word', editable: true },
  docx: { documentType: 'word', editable: true },
  docm: { documentType: 'word', editable: true },
  dot: { documentType: 'word', editable: false },
  dotx: { documentType: 'word', editable: true },
  dotm: { documentType: 'word', editable: true },
  odt: { documentType: 'word', editable: true },
  ott: { documentType: 'word', editable: true },
  fodt: { documentType: 'word', editable: true },
  rtf: { documentType: 'word', editable: true },
  txt: { documentType: 'word', editable: true },
  html: { documentType: 'word', editable: true },
  htm: { documentType: 'word', editable: true },
  mht: { documentType: 'word', editable: true },
  mhtml: { documentType: 'word', editable: true },
  md: { documentType: 'word', editable: true },
  xml: { documentType: 'word', editable: true },
  wps: { documentType: 'word', editable: true },
  stw: { documentType: 'word', editable: true },
  sxw: { documentType: 'word', editable: true },
  hwp: { documentType: 'word', editable: true },
  hwpx: { documentType: 'word', editable: true },
  epub: { documentType: 'word', editable: false },
  fb2: { documentType: 'word', editable: false },
  // Таблицы (cell)
  xls: { documentType: 'cell', editable: true },
  xlsx: { documentType: 'cell', editable: true },
  xlsm: { documentType: 'cell', editable: true },
  xlsb: { documentType: 'cell', editable: true },
  xlt: { documentType: 'cell', editable: false },
  xltx: { documentType: 'cell', editable: true },
  xltm: { documentType: 'cell', editable: true },
  ods: { documentType: 'cell', editable: true },
  ots: { documentType: 'cell', editable: true },
  fods: { documentType: 'cell', editable: true },
  et: { documentType: 'cell', editable: true },
  ett: { documentType: 'cell', editable: true },
  sxc: { documentType: 'cell', editable: false },
  csv: { documentType: 'cell', editable: true },
  tsv: { documentType: 'cell', editable: true },
  numbers: { documentType: 'cell', editable: false },
  // Презентации (slide)
  ppt: { documentType: 'slide', editable: true },
  pptx: { documentType: 'slide', editable: true },
  pptm: { documentType: 'slide', editable: true },
  pps: { documentType: 'slide', editable: false },
  ppsx: { documentType: 'slide', editable: true },
  ppsm: { documentType: 'slide', editable: true },
  pot: { documentType: 'slide', editable: false },
  potx: { documentType: 'slide', editable: true },
  potm: { documentType: 'slide', editable: true },
  odp: { documentType: 'slide', editable: true },
  otp: { documentType: 'slide', editable: true },
  fodp: { documentType: 'slide', editable: true },
  dps: { documentType: 'slide', editable: false },
  dpt: { documentType: 'slide', editable: false },
  sxi: { documentType: 'slide', editable: false },
  key: { documentType: 'slide', editable: false },
  odg: { documentType: 'slide', editable: false },
  // Просмотровые «бумажные» форматы (documentType 'pdf' у DS)
  djvu: { documentType: 'pdf', editable: false },
  xps: { documentType: 'pdf', editable: false },
  oxps: { documentType: 'pdf', editable: false },
};

/** Расширение файла из имени (последняя точка, нижний регистр). */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/** Инфо офисного формата по имени файла; null — не офисный. */
export function officeFormat(name: string): OfficeFormatInfo | null {
  const extension = fileExtension(name);
  // Своя таблица: без hasOwn обращение к «constructor»/«toString» вернуло бы
  // прототип Object.prototype как формат.
  return Object.hasOwn(OFFICE_VIEW_FORMATS, extension)
    ? (OFFICE_VIEW_FORMATS[extension] ?? null)
    : null;
}

/** Чисто текстовые форматы: документ-сервер сам НЕ определяет кодировку
 *  (UTF-8 без BOM / Windows-1251) и спрашивает диалогом «Выбрать параметры
 *  TXT/CSV» — API отдаёт их DS как UTF-8 с BOM (репро 29.09, #138). */
const OFFICE_TEXT_EXTENSIONS = new Set(['txt', 'csv', 'tsv']);

export function isOfficeTextFormat(name: string): boolean {
  return OFFICE_TEXT_EXTENSIONS.has(fileExtension(name));
}
