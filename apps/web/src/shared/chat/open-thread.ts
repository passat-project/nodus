/**
 * Реестр открытого окна треда (#1072): лента канала и окно треда регистрируют
 * ОДИН тот же conversationId (open-conversation.ts), поэтому гейт «смотрю в
 * беседу» глушил и ответы в тредах при СКРЫТОЙ панели — а их в ленте канала
 * не видно. Область тишины для ответа в треде — открытое окно ИМЕННО этого
 * треда: совпадение пары (беседа, корень). Реестр хостов со счётчиком, как у
 * беседы: несколько хостов одного треда (окно треда в странице/карточке)
 * не гасят друг друга; «текущий» — последний заявленный.
 */

interface OpenThread {
  conversationId: string;
  threadRootId: string;
}

const openThreadHosts: OpenThread[] = [];

/** Заявить окно треда открытым (ThreadPane); возвращает release на анмаунт. */
export function acquireOpenThread(conversationId: string, threadRootId: string): () => void {
  const host: OpenThread = { conversationId, threadRootId };
  openThreadHosts.push(host);
  return () => {
    const i = openThreadHosts.indexOf(host);
    if (i !== -1) openThreadHosts.splice(i, 1);
  };
}

/** Открытое окно треда (глушит его попапы/тосты; null — панели нет). */
export function getOpenThread(): OpenThread | null {
  return openThreadHosts.length > 0 ? openThreadHosts[openThreadHosts.length - 1]! : null;
}

/** Совпадает ли открытая область с сообщением: ответ в треде тих только при
 *  открытом окне ЭТОГО треда, корневое — при открытой беседе (ленте). */
export function isOpenThreadMatch(input: {
  conversationId: string;
  threadRootId: string | null;
}): boolean {
  const open = getOpenThread();
  if (input.threadRootId === null) return false;
  return (
    open !== null &&
    open.conversationId === input.conversationId &&
    open.threadRootId === input.threadRootId
  );
}

/** Сброс реестра (только тесты): детерминированное «ничего не открыто». */
export function resetOpenThreadRegistry(): void {
  openThreadHosts.length = 0;
}
