import { Search } from 'lucide-react';
import { useState } from 'react';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { projectsAvailable } from '../../api/projects-available.js';
import { useProjectsList } from '../../api/projects-list.js';
import { ProjectIdentityIcon } from '../../ui/project-identity-icon.js';
import { CustomFieldValueView, refsById } from '../value-view.js';
import { EditorTrigger, type EditorProps } from './editor-kit.js';

/**
 * Проект: выбор из справочника проектов. До модуля проектов (#52) тип в вебе
 * недоступен — плитка в «Новом поле» приглушена, существующее значение
 * показывается именем из ссылок (Р11); в моках проекты есть.
 */
export function ProjectEditor(props: EditorProps) {
  const available = projectsAvailable();
  const { data } = useProjectsList({ enabled: available });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const projects = data?.items ?? [];
  const q = query.trim().toLowerCase();
  const visible = q
    ? projects.filter(
        (project) =>
          project.name.toLowerCase().includes(q) || (project.code ?? '').toLowerCase().includes(q),
      )
    : projects;

  if (!available) {
    return (
      <EditorTrigger variant={props.variant} disabled ariaLabel={props.definition.name}>
        <span className="text-muted-foreground">{ui.customFields.typeUnavailable.project}</span>
      </EditorTrigger>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <EditorTrigger
          variant={props.variant}
          disabled={props.disabled}
          ariaLabel={props.definition.name}
          open={open}
        >
          <CustomFieldValueView
            definition={props.definition}
            value={props.value}
            refs={refsById(props.refs)}
          />
        </EditorTrigger>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5">
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={ui.common.searchPlaceholder}
            aria-label={ui.common.search}
            className="h-8 pl-8 text-sm"
            autoFocus
          />
        </div>
        <div
          className="overflow-y-auto"
          style={{ height: Math.min(Math.max(projects.length, 1), 8) * 36 + 8 }}
          data-no-scrollbar
        >
          {visible.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {ui.filters.notFound}
            </p>
          ) : (
            visible.map((project) => {
              const on = props.value === project.id;
              return (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => {
                    props.onCommit(project.id, [
                      {
                        kind: 'project',
                        id: project.id,
                        name: project.name,
                        avatarUrl: null,
                        archived: false,
                      },
                    ]);
                    setOpen(false);
                    // Программное закрытие минует onOpenChange — поиск чистим
                    // здесь, чтобы следующий показ начинался с полного списка.
                    setQuery('');
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-accent/60',
                    on ? 'text-port' : 'text-secondary-foreground',
                  )}
                >
                  <ProjectIdentityIcon color={project.color} className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{project.name}</span>
                  {project.code ? (
                    <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
                      {project.code}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
