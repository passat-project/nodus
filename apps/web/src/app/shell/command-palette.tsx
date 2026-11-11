import { FolderOpen, House, ListTodo, Mail, MessageSquare, Sparkles, Users } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ui } from '@nodus/contracts';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@nodus/ui/components/command';
import { Dialog, DialogContent, DialogTitle } from '@nodus/ui/components/dialog';
import { cn } from '@nodus/ui/lib/utils';

import { useConversations } from '../../features/chat/api/chat-api.js';
import { useUsersList } from '../../features/directory/api/directory-api.js';
import { projectsAvailable } from '../../shared/api/projects-available.js';
import { useProjectsList } from '../../features/projects/api/projects-api.js';
import { useTasksSearch } from '../../features/tasks/api/tasks-api.js';
import { letterRows, useLettersInfinite } from '../../shared/api/letters-list.js';
import { useDebouncedValue } from '../../shared/lib/use-debounced-value.js';
import { PersonAvatar } from '../../shared/ui/person-avatar.js';
import { useShellStore } from './shell-store.js';
import { useOpenCard } from './use-card-stack.js';

const actions = [
  { to: '/home', label: ui.nav.home, icon: House },
  { to: '/tasks', label: ui.nav.tasks, icon: ListTodo },
  { to: '/letters', label: ui.nav.letters, icon: Mail },
  { to: '/projects', label: ui.nav.projects, icon: FolderOpen },
  { to: '/chat', label: ui.nav.chat, icon: MessageSquare },
  { to: '/employees', label: ui.nav.employees, icon: Users },
];

/** Ctrl+K: умный поиск по всем сущностям портала (вау №4, §10.7).
 *  Сущности открываются КАРТОЧКОЙ В СТЕКЕ поверх текущего раздела
 *  (ADR-0009) — поиск не уводит со страницы; беседы — в мессенджер. */
export function CommandPalette() {
  const open = useShellStore((s) => s.commandOpen);
  const setOpen = useShellStore((s) => s.setCommandOpen);
  const navigate = useNavigate();
  const openCard = useOpenCard();
  const { data: users } = useUsersList();
  const { data: projects } = useProjectsList({ enabled: projectsAvailable() });
  const { data: chats } = useConversations();
  const [query, setQuery] = useState('');
  const { data: tasks } = useTasksSearch(query.trim());
  // Письма — серверный поиск зарегистрированных (№, тема, их №,
  // корреспондент) с задержкой: запрос не на каждую букву.
  const letterSearch = useDebouncedValue(query.trim(), 200);
  const lettersQuery = useLettersInfinite(
    null,
    { search: letterSearch || undefined },
    { enabled: open && letterSearch !== '' },
  );

  // Сброс запроса при закрытии — во время рендера (канон React «adjust state
  // during render»: без лишнего кадра со старым состоянием, аудит #45).
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) setQuery('');
  }

  const q = query.trim().toLowerCase();
  const stems = q
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .map((w) => w.slice(0, 5));
  const has = (text: string) => {
    const t = text.toLowerCase();
    return t.includes(q) || (stems.length > 0 && stems.every((s) => t.includes(s)));
  };
  const letters = q === '' ? [] : letterRows(lettersQuery.data).slice(0, 8);

  function go(to: string, params?: Record<string, string>) {
    setOpen(false);
    void navigate({ to, params } as never);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden bg-popover p-0 text-popover-foreground">
        <DialogTitle className="sr-only">{ui.topbar.smartSearch}</DialogTitle>
        <Command shouldFilter={false}>
          <CommandInput
            className="pr-8"
            placeholder={ui.topbar.smartSearchHint}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>{ui.common.empty}</CommandEmpty>
            {q === '' && (
              <CommandGroup heading={ui.topbar.smartSearch}>
                {actions.map((action) => (
                  <CommandItem key={action.to} value={action.to} onSelect={() => go(action.to)}>
                    <action.icon data-icon="inline-start" />
                    {action.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {q !== '' && (
              <>
                {(tasks?.items ?? []).filter((t) => has(t.title)).length > 0 && (
                  <CommandGroup heading={ui.nav.tasks}>
                    {(tasks?.items ?? [])
                      .filter((t) => has(t.title))
                      .map((task) => (
                        <CommandItem
                          key={task.id}
                          value={task.id}
                          onSelect={() => {
                            setOpen(false);
                            openCard({ kind: 'task', id: task.id });
                          }}
                        >
                          <ListTodo data-icon="inline-start" />
                          {task.title}
                        </CommandItem>
                      ))}
                  </CommandGroup>
                )}
                {letters.length > 0 && (
                  <CommandGroup heading={ui.nav.letters}>
                    {letters.map((letter) => (
                      <CommandItem
                        key={letter.id}
                        value={letter.id}
                        onSelect={() => {
                          setOpen(false);
                          openCard({ kind: 'letter', id: letter.id });
                        }}
                      >
                        <Mail data-icon="inline-start" />
                        <span className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums">
                          {letter.regNumber}
                        </span>
                        <span
                          className={cn('truncate', !letter.subject && 'text-muted-foreground')}
                        >
                          {letter.subject ?? ui.letters.noSubject}
                        </span>
                        {letter.counterparty ? (
                          <span className="ml-auto max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">
                            {letter.counterparty.name}
                          </span>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {(projects?.items ?? []).filter((p) => has(p.name) || has(p.code ?? '')).length >
                  0 && (
                  <CommandGroup heading={ui.nav.projects}>
                    {(projects?.items ?? [])
                      .filter((p) => has(p.name) || has(p.code ?? ''))
                      .map((project) => (
                        <CommandItem
                          key={project.id}
                          value={project.id}
                          onSelect={() => {
                            setOpen(false);
                            openCard({ kind: 'project', id: project.id });
                          }}
                        >
                          <FolderOpen data-icon="inline-start" />
                          {project.name}
                        </CommandItem>
                      ))}
                  </CommandGroup>
                )}
                {(chats?.items ?? []).filter(
                  (c) => has(c.title ?? '') || has(c.membersPreview[0]?.displayName ?? ''),
                ).length > 0 && (
                  <CommandGroup heading={ui.nav.chat}>
                    {(chats?.items ?? [])
                      .filter(
                        (c) => has(c.title ?? '') || has(c.membersPreview[0]?.displayName ?? ''),
                      )
                      .map((chat) => (
                        <CommandItem
                          key={chat.id}
                          value={chat.id}
                          onSelect={() => go('/chat/$conversationId', { conversationId: chat.id })}
                        >
                          <MessageSquare data-icon="inline-start" />
                          {chat.title ?? chat.membersPreview[0]?.displayName}
                        </CommandItem>
                      ))}
                  </CommandGroup>
                )}
                {(users?.items ?? []).filter((u) => has(u.displayName)).length > 0 && (
                  <CommandGroup heading={ui.nav.employees}>
                    {(users?.items ?? [])
                      .filter((u) => has(u.displayName))
                      .map((person) => (
                        <CommandItem
                          key={person.id}
                          value={person.id}
                          onSelect={() => {
                            setOpen(false);
                            openCard({ kind: 'employee', id: person.id });
                          }}
                        >
                          <PersonAvatar
                            name={person.displayName}
                            avatarUrl={person.avatarUrl}
                            decorative
                            className="size-6"
                          />
                          {person.displayName}
                          <span className="ml-auto text-xs text-muted-foreground">
                            {person.positionName}
                          </span>
                        </CommandItem>
                      ))}
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
        <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" />
          {ui.topbar.smartSearchHint}
        </p>
      </DialogContent>
    </Dialog>
  );
}
