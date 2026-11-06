import { ArrowLeft, Search } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { CustomFieldRefKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import { cn } from '@nodus/ui/lib/utils';

import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { useLettersInfinite, letterRows } from '../../api/letters-list.js';
import { useProjectStructure } from '../../api/project-structure.js';
import { useProjectsList } from '../../api/projects-list.js';
import { useTasksSearch } from '../../api/tasks-search.js';
import { CustomFieldValueView, refsById } from '../value-view.js';
import { EditorTrigger, type EditorProps } from './editor-kit.js';

/**
 * Редакторы ссылок на записи (#631, Р5): задача, письмо, папка. Значение —
 * id записи, показ — именем из refs; выбранная запись сразу несёт ref для
 * оптимистичного показа. Пикеры: задачи/письма — серверный поиск (как
 * палитра и журналы), папка — двухшаговый выбор (проект → узел структуры).
 * Видимость записи актёру проверяет сервер (значение — только на
 * существующую и доступную запись, недоступная цель — 422 not_found).
 */

interface RefOption {
  id: string;
  label: string;
  hint?: string;
}

function commitRef(
  onCommit: EditorProps['onCommit'],
  kind: CustomFieldRefKind,
  option: RefOption,
  close: () => void,
): void {
  onCommit(option.id, [
    { kind, id: option.id, name: option.label, avatarUrl: null, archived: false, color: null },
  ]);
  close();
}

function OptionRow({
  option,
  on,
  onClick,
}: {
  option: RefOption;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm hover:bg-accent/60',
        on ? 'text-port' : 'text-secondary-foreground',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      {option.hint ? (
        <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
          {option.hint}
        </span>
      ) : null}
    </button>
  );
}

/** Пиковый поповер: клиентский фильтр по готовым опциям + шапка-дополнение
 *  (шаг «проект» у папки). Текст поиска контролирует вызывающий — он же
 *  кормит серверный запрос; options === null — «ничего не найдено/не готово». */
function RefPopover({
  props,
  kind,
  options,
  text,
  onTextChange,
  header,
}: {
  props: EditorProps;
  kind: CustomFieldRefKind;
  options: RefOption[];
  text: string;
  onTextChange: (next: string) => void;
  header?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const q = text.trim().toLowerCase();
  const visible = q ? options.filter((option) => option.label.toLowerCase().includes(q)) : options;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) onTextChange('');
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
        {header}
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={ui.common.searchPlaceholder}
            aria-label={ui.common.search}
            className="h-8 pl-8 text-sm"
            autoFocus
          />
        </div>
        <div className="h-64 overflow-y-auto" data-no-scrollbar>
          {visible.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {ui.filters.notFound}
            </p>
          ) : (
            visible.map((option) => (
              <OptionRow
                key={option.id}
                option={option}
                on={props.value === option.id}
                onClick={() => commitRef(props.onCommit, kind, option, () => setOpen(false))}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Задача: серверный поиск по титулу/номеру (как палитра Ctrl+K). */
export function TaskEditor(props: EditorProps) {
  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim(), 250);
  const { data } = useTasksSearch(query);
  const options = (data?.items ?? []).map((task) => ({
    id: task.id,
    label: task.title,
    hint: `№ ${task.number}`,
  }));
  return (
    <RefPopover props={props} kind="task" options={options} text={text} onTextChange={setText} />
  );
}

/** Письмо: серверный поиск по журналам (тема + корреспондент). */
export function LetterEditor(props: EditorProps) {
  const [text, setText] = useState('');
  const query = useDebouncedValue(text.trim(), 250);
  const { data } = useLettersInfinite(null, query ? { search: query } : {});
  const options = letterRows(data).map((letter) => ({
    id: letter.id,
    label: letter.subject ?? ui.letters.noSubject,
    hint: letter.regNumber ?? undefined,
  }));
  return (
    <RefPopover props={props} kind="letter" options={options} text={text} onTextChange={setText} />
  );
}

/** Папка: двухшаговый выбор — проект, затем узел его структуры. */
export function NodeEditor(props: EditorProps) {
  const [text, setText] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const { data: projects } = useProjectsList();
  const { data: structure } = useProjectStructure(projectId);
  const options =
    projectId === null
      ? (projects?.items ?? []).map((project) => ({
          id: project.id,
          label: project.name,
          hint: project.code ?? undefined,
        }))
      : (structure?.nodes ?? []).map((node) => ({ id: node.id, label: node.name }));
  const projectName = (projects?.items ?? []).find((project) => project.id === projectId)?.name;
  return (
    <RefPopover
      props={props}
      kind="node"
      options={options}
      text={text}
      onTextChange={setText}
      header={
        projectId !== null ? (
          <div className="mb-1 flex items-center gap-1 border-b pb-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-1.5 text-xs"
              onClick={() => setProjectId(null)}
            >
              <ArrowLeft data-icon="inline-start" className="size-3.5" strokeWidth={1.75} />
              <span className="max-w-56 truncate">{projectName}</span>
            </Button>
          </div>
        ) : undefined
      }
    />
  );
}
