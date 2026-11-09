import { useSearch } from '@tanstack/react-router';

import { ModuleAccessMatrix } from '../../../shared/access/module-access-matrix.js';
import { FieldsTab } from '../components/fields/fields-tab.js';
import { ProcessesTab } from '../components/processes/processes-tab.js';
import { RegistriesTab } from '../components/registries/registries-tab.js';

/**
 * Раздел «Автоматизация» (эпик #377): единый дом настройки.
 * Вкладки — в топбаре шелла (`nav-registry`): «Процессы» (библиотека типов
 * и редактор маршрутов), «Атрибуты» (реестр кастомных полей, #431) и
 * «Права доступа» (матрица прав раздела, #379, ADR-0034 — вкладка
 * появляется по каталогу прав).
 * Модуль — окно-сплит (флаг `splitWindow` реестра навигации): ось контура
 * идёт до правого края рамы; «Атрибуты» под ней — журнал-таблица.
 * Глубокие ссылки: `/automation?type=<id>`, `/automation?tab=fields&field=<id>`,
 * `/automation?tab=access`.
 */
export function AutomationPage() {
  const search = useSearch({ strict: false }) as { tab?: string };
  if (search.tab === 'access') return <ModuleAccessMatrix module="automation" />;
  if (search.tab === 'registries') return <RegistriesTab />;
  return search.tab === 'fields' ? <FieldsTab /> : <ProcessesTab />;
}
