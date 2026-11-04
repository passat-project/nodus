import { Module } from '@nestjs/common';

import { LettersRepository } from './letters/letters.repository.js';
import { LetterChatReaderProvider } from './ports/letter-chat-reader.provider.js';
import { LETTER_CHAT_READER } from './ports/letter-chat-reader.port.js';
import { LetterFieldValuesProvider } from './ports/letter-field-values.provider.js';
import { LETTER_FIELD_VALUES_READER } from './ports/letter-field-values.port.js';
import { LetterVisibilityProvider } from './ports/letter-visibility.provider.js';
import { LETTER_VISIBILITY_READER } from './ports/letter-visibility.port.js';

/**
 * Порты корреспонденции для чужих модулей (ADR-0012, #55): мост чата
 * (`LETTER_CHAT_READER`) читает состав беседы и видимость письма, не трогая
 * таблицы `letters`; значения атрибутов писем (`LETTER_FIELD_VALUES_READER`,
 * #575) — для окна удаления определения в custom-fields; видимость писем
 * (`LETTER_VISIBILITY_READER`, #461) — счётчик «Писем» карточки CRM по тому
 * же правилу, что реестр. Единственная допустимая форма межмодульного
 * импорта; доменные сервисы наружу не экспортируются.
 */
@Module({
  providers: [
    LettersRepository,
    LetterChatReaderProvider,
    { provide: LETTER_CHAT_READER, useExisting: LetterChatReaderProvider },
    LetterFieldValuesProvider,
    { provide: LETTER_FIELD_VALUES_READER, useExisting: LetterFieldValuesProvider },
    LetterVisibilityProvider,
    { provide: LETTER_VISIBILITY_READER, useExisting: LetterVisibilityProvider },
  ],
  exports: [LETTER_CHAT_READER, LETTER_FIELD_VALUES_READER, LETTER_VISIBILITY_READER],
})
export class CorrespondencePortsModule {}
