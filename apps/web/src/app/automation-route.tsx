import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { AutomationPage } from '../features/automation/pages/automation-page.js';
import { useArchiveNodeKind } from '../features/projects/node-kinds/api/node-kinds-api.js';
import { useSetProjectTypeArchived } from '../features/projects/api/project-catalog-mutations.js';
import {
  NodeKindScreenHost,
  ProjectTypeWorkspaceHost,
  TypeSettingsHost,
  renderKindCreate,
  renderProcessTypeCreate,
  renderProjectTypeCreate,
} from './automation-hosts.js';
import { replaceProcessesSurface } from '../shared/workflow/processes-surface-search.js';
import { preloadTypeCardEntries } from './shell/card-type-entry.js';

/**
 * Раздел «Автоматизация» — композиция фич на уровне app (cross-feature
 * импорт запрещён, I6): вкладка «Процессы» — единый вход (#857), её
 * проектные слоты (карточка типа проекта, карточка типа папки, окна
 * создания, окно атрибута) заполняются компонентами фич projects и
 * automation в общих хостах `automation-hosts` — тех же, что рендерят
 * карточки типов в стеке. Левая колонка видна всегда: `?ptype=`, `?type=`,
 * `?ftype=`, `?noproject=1` выбирают, что показать справа, — как выбор
 * беседы в чатах, без полноэкранных режимов. `TypeSettingsHost` — резидентное
 * окно настроек типа: шестерёнка бара и «⋯ → Настройки типа…» открывают его,
 * не переезжая рамой на другой тип.
 */
export function AutomationRoute() {
  const navigate = useNavigate();
  const archiveProject = useSetProjectTypeArchived();
  const archiveKind = useArchiveNodeKind();
  // Тела карточек типов — ленивый кусок вне стартового пакета: грузим при
  // входе в раздел, чтобы клик по строке списка открыл карточку без ожидания.
  useEffect(() => {
    void preloadTypeCardEntries();
  }, []);

  return (
    <>
      <AutomationPage
        renderProjectWorkspace={(slot) => <ProjectTypeWorkspaceHost id={slot.typeId} />}
        renderFolderCard={(slot) => (
          <NodeKindScreenHost
            id={slot.kindId}
            // Сущность пропала — рама уходит на поверхность по умолчанию.
            onMissing={() =>
              void navigate({
                to: '/automation',
                search: (prev) => replaceProcessesSurface(prev, {}),
              })
            }
          />
        )}
        renderProjectTypeCreate={renderProjectTypeCreate}
        renderProcessTypeCreate={renderProcessTypeCreate}
        renderKindCreate={renderKindCreate}
        onArchiveProject={(id, archived) => archiveProject.mutate({ id, archived })}
        onArchiveNodeKind={(id, archived) => archiveKind.mutate({ id, archived })}
      />
      <TypeSettingsHost />
    </>
  );
}
