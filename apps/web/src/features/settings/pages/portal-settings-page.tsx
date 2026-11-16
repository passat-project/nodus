import { Server, ShieldCheck } from 'lucide-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Permission, ui } from '@nodus/contracts';
import { Empty, EmptyTitle } from '@nodus/ui/components/empty';
import { cn } from '@nodus/ui/lib/utils';

import { useAuthStore } from '../../../shared/auth-store.js';
import { ModuleAccessMatrix } from '../../../shared/access/module-access-matrix.js';
import { FileServersSection } from '../components/file-servers-section.js';

const SECTIONS = [
  { id: 'file-servers', label: ui.portalSettings.sections.fileServers, icon: Server },
  { id: 'access', label: ui.portalSettings.sections.access, icon: ShieldCheck },
] as const;

type SettingsSection = (typeof SECTIONS)[number]['id'];

/**
 * «Настройки портала» (#558, эпик #869): первый живой раздел — «Файловые
 * серверы», плюс «Права доступа» раздела «Настройки». Каркас минимальный:
 * #276 добавит остальные разделы и общую навигацию, #871 — «Компанию».
 * Вход — из меню «Настройки» левой рейки, доступ — право
 * `portal.settings.manage` (сервер проверяет сам, I8).
 */
export function PortalSettingsPage() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { section?: string };
  const permissions = useAuthStore((s) => s.user?.permissions ?? []);
  const canManage = permissions.includes(Permission.PORTAL_SETTINGS_MANAGE);
  const section: SettingsSection = search.section === 'access' ? 'access' : 'file-servers';

  if (!canManage) {
    return (
      <div className="flex h-full items-center justify-center">
        <Empty>
          <EmptyTitle>{ui.portalSettings.noAccess}</EmptyTitle>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-64 shrink-0 flex-col gap-1 px-4 py-4">
        <h1 className="px-2 pb-3 text-lg font-semibold text-foreground">
          {ui.portalSettings.title}
        </h1>
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          const active = item.id === section;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() =>
                void navigate({
                  to: '/settings',
                  search: (prev) => ({ ...prev, section: item.id }),
                })
              }
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium transition-colors',
                active
                  ? 'bg-sidebar-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </aside>

      <div className="min-h-0 min-w-0 flex-1">
        {section === 'access' ? <ModuleAccessMatrix module="settings" /> : <FileServersSection />}
      </div>
    </div>
  );
}
