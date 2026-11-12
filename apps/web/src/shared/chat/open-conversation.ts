import { isModalLayerOpen } from '../attention/modal-layers.js';
import { desktopDismissPopups, isDesktopShell } from '../desktop/desktop-bridge.js';

/**
 * Реестр хостов открытой беседы (#300): одну беседу держат НЕСКОЛЬКО хостов
 * (лента канала + окно треда + карточка мессенджера). Раньше общий
 * module-level маркер затирался null при анмаунте любого хоста — закрытие
 * окна треда гасило признак «смотрю в беседу», и попапы прилетали в открытый
 * чат. Реестр живёт до последнего хоста; «текущая» — последний заявленный
 * (верхняя карточка/окно поверх страницы — то, на что смотрит пользователь).
 *
 * Уведомления — только попапы десктоп-оболочки (#650): браузерный путь
 * (Notification API, opt-in фоновой вкладки) удалён; здесь остаётся гейт
 * «беседа открыта» для попапов оболочки и тост-контура уведомлений.
 */

const openConversationHosts: { conversationId: string }[] = [];

/**
 * Заявить беседу открытой (хост ленты/треда/карточки); возвращает release —
 * вызвать на анмаунте. Открыл беседу — попапы оболочки этой беседы гаснут,
 * не висят устаревшими (модель Telegram unlinkHistory); вне оболочки тихо.
 */
export function acquireOpenConversation(conversationId: string): () => void {
  const host = { conversationId };
  openConversationHosts.push(host);
  if (isDesktopShell()) {
    void desktopDismissPopups(conversationId);
  }
  return () => {
    const i = openConversationHosts.indexOf(host);
    if (i !== -1) openConversationHosts.splice(i, 1);
  };
}

/** Открытая беседа (глушит её тосты и попапы; B6 — читает toast-стор). */
export function getOpenConversation(): string | null {
  // Накрытая модальным слоем беседа «не открыта» (#809): пользователь смотрит
  // в окно/просмотрщик, а не в ленту — попап по беседе обязан прийти. Реестр
  // хостов снимает сам `useConversationHost`; проверка здесь закрывает окно
  // между мутацией DOM и эффектом React.
  if (isModalLayerOpen()) return null;
  return openConversationHosts.length > 0
    ? openConversationHosts[openConversationHosts.length - 1]!.conversationId
    : null;
}

/** Сброс реестра (только тесты): детерминированное «ничего не открыто». */
export function resetOpenConversationRegistry(): void {
  openConversationHosts.length = 0;
}
