/**
 * Побочный модуль: поднимает полифилл `crypto.randomUUID` ДО остального графа
 * приложения. Отдельный импорт, а не вызов в `main.tsx`, — чтобы модули,
 * использующие UUID на инициализации, не упали раньше установки (#675).
 */
import { installLanCrypto } from './lan-crypto.js';

installLanCrypto();
