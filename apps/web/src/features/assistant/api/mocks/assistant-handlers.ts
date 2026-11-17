import { aiSettingsHandlers } from './ai-settings-handlers.js';
import { assistantChatHandlers } from './assistant-chat-handlers.js';

/**
 * Все моки домена `assistant` (#889): настройки ИИ-агента (#894) и диалог с
 * потоком прогона (#895). Хендлеры разнесены по ответственности: настройки
 * провайдеров и сессии/прогоны — разные экраны и разные права.
 */
export const assistantHandlers = [...aiSettingsHandlers, ...assistantChatHandlers];
