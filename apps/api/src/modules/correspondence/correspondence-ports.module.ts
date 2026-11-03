import { Module } from '@nestjs/common';

import { LettersRepository } from './letters/letters.repository.js';
import { LetterChatReaderProvider } from './ports/letter-chat-reader.provider.js';
import { LETTER_CHAT_READER } from './ports/letter-chat-reader.port.js';
import { LetterFieldValuesProvider } from './ports/letter-field-values.provider.js';
import { LETTER_FIELD_VALUES_READER } from './ports/letter-field-values.port.js';

/**
 * Порты корреспонденции для чужих модулей (ADR-0012, #55): мост чата
 * (`LETTER_CHAT_READER`) читает состав беседы и видимость письма, не трогая
 * таблицы `letters`; значения атрибутов писем (`LETTER_FIELD_VALUES_READER`,
 * #575) — для окна удаления определения в custom-fields. Единственная
 * допустимая форма межмодульного импорта; доменные сервисы наружу не
 * экспортируются.
 */
@Module({
  providers: [
    LettersRepository,
    LetterChatReaderProvider,
    { provide: LETTER_CHAT_READER, useExisting: LetterChatReaderProvider },
    LetterFieldValuesProvider,
    { provide: LETTER_FIELD_VALUES_READER, useExisting: LetterFieldValuesProvider },
  ],
  exports: [LETTER_CHAT_READER, LETTER_FIELD_VALUES_READER],
})
export class CorrespondencePortsModule {}
