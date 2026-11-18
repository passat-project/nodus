/**
 * Публичный вход выбора инструмента (#926): языковой слой, выводы из каталога,
 * ранжирование и симулятор диспетчера. Потребители (`tools.search`, dispatcher,
 * eval, линтер каталога, манифест) импортируют только этот файл; внутреннее
 * деление — деталь реализации.
 */
export * from './retrieval-infer.js';
export * from './retrieval-lang.js';
export * from './retrieval-rank.js';
export * from './retrieval-router.js';
