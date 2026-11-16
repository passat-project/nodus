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
 *
 * Каркас — как у журналов: одна шапка страницы (h-14, без линии) и рабочая
 * зона; разделы — вертикальный навигатор в мягкой раме. Два заголовка одного
 * кегля (страница/раздел) конкурировали за точку входа — раздел помечается
 * меткой `NodeLabel` на одной оси с его пунктом навигатора.
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 px-6">
        <h1 className="text-xl font-semibold text-balance text-foreground">
          {ui.portalSettings.title}
        </h1>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={ui.portalSettings.title}
          className="flex w-52 shrink-0 flex-col gap-0.5 px-3 pb-4"
        >
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
                  'flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring/30',
                  active
                    ? 'bg-accent/80 text-foreground'
                    : 'text-muted-foreground hover:bg-accent/40 hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-h-0 min-w-0 flex-1">
          {section === 'access' ? <ModuleAccessMatrix module="settings" /> : <FileServersSection />}
        </div>
      </div>
    </div>
  );
}
