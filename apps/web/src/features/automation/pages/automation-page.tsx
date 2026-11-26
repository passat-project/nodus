import { useSearch } from '@tanstack/react-router';

import { ModuleAccessMatrix } from '../../../shared/access/module-access-matrix.js';
import { FieldsTab } from '../components/fields/fields-tab.js';
import {
  ProcessesScreen,
  type ProcessesScreenSlots,
} from '../components/processes/processes-screen.js';
import { RegistriesTab } from '../components/registries/registries-tab.js';

/**
 * Раздел «Автоматизация» (эпик #377): единый дом настройки. Вкладки — в
 * топбаре шелла (`nav-registry`): «Процессы» (единый вход #857 — типы
 * проектов, задач, писем и папок), «Атрибуты» (реестр кастомных полей,
 * #431), «Реестры» и «Права доступа» (матрица прав раздела, #379,
 * ADR-0034). Модуль — окно-сплит (флаг `splitWindow` реестра навигации):
 * ось контура идёт до правого края рамы. Легаси-адрес `tab=project-schemas`
 * перехватывает `beforeLoad` маршрута (#857). Слоты «Процессов» (рабочая
 * область типа проекта, окна создания) заполняет `AutomationRoute`.
 * Глубокие ссылки: `/automation?type=&ptype=&ftype=&noproject=1`,
 * `/automation?tab=fields&field=<id>`, `/automation?tab=access`.
 */
export function AutomationPage(slots: ProcessesScreenSlots) {
  const search = useSearch({ strict: false }) as { tab?: string };
  if (search.tab === 'access') return <ModuleAccessMatrix module="automation" />;
  if (search.tab === 'registries') return <RegistriesTab />;
  return search.tab === 'fields' ? <FieldsTab /> : <ProcessesScreen {...slots} />;
}
