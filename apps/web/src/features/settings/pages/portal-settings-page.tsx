import { useSearch } from '@tanstack/react-router';
import { Permission, ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';

import { useAuthStore } from '../../../shared/auth-store.js';
import { ModuleAccessMatrix } from '../../../shared/access/module-access-matrix.js';
import { AiSettingsSection } from '../components/ai-settings-section.js';
import { FileServersSection } from '../components/file-servers-section.js';

/**
 * «Настройки портала» (#558, эпик #869): техническая страница из меню
 * «Настройки» левой рейки (маршрут `/settings`).
 *
 * Разделы — вкладки ТОПБАРА, а не список слева (вердикт владельца 16.11.2026:
 * «вкладки сверху с линиями графа», левое перечисление — не наш стиль и
 * отнимало ширину у матрицы прав): реестр навигации объявляет страницу как
 * модуль с `rail: false`, поэтому порядок рейки и «Скрытое» её не видят.
 * Без права `portal.settings.manage` — «Нет доступа» (сервер проверяет сам,
 * I8); вкладки топбара скрыты тем же правом.
 *
 * Каркас минимальный: #276 добавит остальные разделы, #871 — «Компанию».
 */
export function PortalSettingsPage() {
  const search = useSearch({ strict: false }) as { tab?: string };
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canManage = permissions.includes(Permission.PORTAL_SETTINGS_MANAGE);

  if (!canManage) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty>
          <EmptyTitle>{ui.portalSettings.noAccess}</EmptyTitle>
        </Empty>
      </div>
    );
  }

  if (search.tab === 'access') return <ModuleAccessMatrix module="settings" />;
  // ИИ-агент (#894): провайдеры моделей и правила ассистента.
  if (search.tab === 'ai') return <AiSettingsSection />;
  return <FileServersSection />;
}
