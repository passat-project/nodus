/**
 * Фрагмент цитаты — ТОЛЬКО текст сообщения (#1021, решение владельца
 * 24.11.2026): выделение мышью легко заезжает на имя автора, мету времени
 * («изменено», чипы галочек), чипы файлов (название/размер) — раньше всё это
 * попадало в частичную цитату («Ответить с цитатой», баббл над выделением).
 * Выделение срезается до содержимого хоста текста сообщения
 * (`[data-slot="message-text"]`, тот же слот у `MessageText` в пузырях и
 * карточках постов) внутри контейнера `data-chat-message`.
 * Хоста нет (чисто медийное сообщение) — фрагмент пуст: цитировать нечего,
 * кроме текста. Сверху функции-потребители по-прежнему сами проверяют,
 * что выделение целиком внутри СВОЕГО контейнера.
 */

const TEXT_HOST_SELECTOR = '[data-slot="message-text"]';

/** Пересечение выделения с границами элемента (null — пересечения нет).
 *  Позиция концов — через `compareDocumentPosition`/`contains`: у jsdom
 *  `Range.compareBoundaryPoints` реализован с другой семантикой, а тесты
 *  гоняются именно в jsdom. */
function clipRangeToHost(range: Range, host: Element): Range | null {
  const startInside = host.contains(range.startContainer);
  const endInside = host.contains(range.endContainer);
  const startsBefore =
    !startInside &&
    Boolean(host.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_PRECEDING);
  const endsAfter =
    !endInside &&
    Boolean(host.compareDocumentPosition(range.endContainer) & Node.DOCUMENT_POSITION_FOLLOWING);

  if (!startInside && !endInside) {
    // Оба конца вне хоста: выделение либо накрывает хост целиком (цитата =
    // весь текст сообщения), либо не пересекается с ним вовсе.
    if (!(startsBefore && endsAfter)) return null;
    const hostRange = document.createRange();
    hostRange.selectNodeContents(host);
    return hostRange;
  }
  const clipped = document.createRange();
  if (startInside) clipped.setStart(range.startContainer, range.startOffset);
  else clipped.setStart(host, 0);
  if (endInside) clipped.setEnd(range.endContainer, range.endOffset);
  else clipped.setEnd(host, host.childNodes.length);
  return clipped.collapsed ? null : clipped;
}

/** Текст выделения, ограниченный текстом сообщения; null — текста в
 *  выделении нет (или выделение пустое). */
export function selectionFragmentIn(container: Element): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const host = container.querySelector(TEXT_HOST_SELECTOR);
  if (!host) return null;
  const clipped = clipRangeToHost(selection.getRangeAt(0), host);
  if (!clipped) return null;
  const fragment = clipped.toString().trim();
  return fragment.length > 0 ? fragment : null;
}
