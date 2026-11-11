import { Camera, ChevronDown, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ConversationListItem, ConversationMemberRole, UserListItem } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nodus/ui/components/dialog';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';
import { Popover, PopoverContent, PopoverTrigger } from '@nodus/ui/components/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@nodus/ui/components/select';
import { Textarea } from '@nodus/ui/components/textarea';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import { useUsersList } from '../../../shared/api/users-list.js';
import { useAuthStore } from '../../../shared/auth-store.js';
import { withoutPatronymic } from '../../../shared/lib/format.js';
import { avatarIssueMessage, validateAvatarFile } from '../../../shared/chat/avatar-upload.js';
import { useSetConversationAvatar } from '../../../shared/chat/manage-api.js';
import { PersonAvatar, PersonAvatarById } from '../../../shared/ui/person-avatar.js';
import { useCreateConversation } from '../api/chat-api.js';

/**
 * Создание группового чата/канала (#91, референс окна «Создание чата»
 * Bitrix24): название + аватарка (#186: выбор файла с превью, загрузка после
 * создания беседы), участники («человек или целый отдел»), сворачиваемые
 * «Настройки чата» (тип закрытый/открытый, описание) и «Права доступа»
 * (владелец, модераторы, матрица минимальных ролей — контракт
 * conversationPermissionsSchema). Модераторы — заглушка до серверных прав
 * (как «Опрос» линии A); создание живое: беседа встаёт в список первой.
 * АВТОУДАЛЕНИЯ СООБЩЕНИЙ ЗДЕСЬ НЕТ (решение владельца 24.09.2026, #96):
 * переключатель не чинили, а фичу убрали целиком — вместе с полем контракта и
 * i18n-строкой; TTL сообщений в продукте не появится без нового решения
 * владельца.
 * I5-обоснование размера (>300): файл — полная сборка окна Bitrix24 (шапка +
 * участники + две сворачиваемые секции с матрицей прав); дробление
 * преждевременно до прихода серверных прав (#58), секции уже вынесены в
 * локальные компоненты.
 */
export type CreateConversationKind = 'group' | 'project_channel';

type PermKey = 'addMembers' | 'removeMembers' | 'changeInfo' | 'post' | 'manageSettings';

/** Дефолты матрицы прав — зеркало серверных (контракт #91, модель Bitrix24). */
const DEFAULT_PERMISSIONS: Record<PermKey, ConversationMemberRole> = {
  addMembers: 'member',
  removeMembers: 'admin',
  changeInfo: 'admin',
  post: 'member',
  manageSettings: 'owner',
};

const PERM_LABELS: Record<PermKey, string> = {
  addMembers: ui.chat.permAddMembers,
  removeMembers: ui.chat.permRemoveMembers,
  changeInfo: ui.chat.permChangeInfo,
  post: ui.chat.permPost,
  manageSettings: ui.chat.permManageSettings,
};

function RoleSelect({
  permKey,
  value,
  onChange,
}: {
  permKey: PermKey;
  value: ConversationMemberRole;
  onChange: (role: ConversationMemberRole) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{PERM_LABELS[permKey]}</span>
      <Select value={value} onValueChange={(role) => onChange(role as ConversationMemberRole)}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="end" sideOffset={4}>
          <SelectItem value="member">{ui.chat.roleMember}</SelectItem>
          <SelectItem value="admin">{ui.chat.roleAdmin}</SelectItem>
          <SelectItem value="owner">{ui.chat.roleOwner}</SelectItem>
        </SelectContent>
      </Select>
    </label>
  );
}

/** Сворачиваемая секция окна создания (модель аккордеонов Bitrix24). */
function CreateSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <NodeLabel label={title} />
        <ChevronDown
          className={cn(
            'ml-auto size-4 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          strokeWidth={1.75}
        />
      </button>
      {open ? <div className="flex flex-col gap-4 px-3 pt-1 pb-4">{children}</div> : null}
    </section>
  );
}

function TypeRadio({
  checked,
  title,
  hint,
  onSelect,
}: {
  checked: boolean;
  title: string;
  hint: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className="flex items-start gap-2.5 text-left"
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          checked ? 'border-info' : 'border-input',
        )}
      >
        {checked ? <span className="size-2 rounded-full bg-info" /> : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

export function ChatCreateDialog({
  kind,
  onCreated,
  onClose,
}: {
  kind: CreateConversationKind;
  onCreated: (conversationId: string) => void;
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const { data: users } = useUsersList();
  const create = useCreateConversation();
  const setAvatar = useSetConversationAvatar();

  const [title, setTitle] = useState('');
  // Аватар при создании (#186): файл выбирается сразу (превью в кнопке),
  // загружается ПОСЛЕ создания беседы (multipart на :id/avatar, право
  // changeInfo у создателя-owner есть всегда).
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  // Превью — blob-URL с жизненным циклом эффекта: смена/сброс файла и
  // закрытие окна ревочат прежний URL (useMemo создавал URL без revoke —
  // утечка blob на каждый выбор; StrictMode-повтор эффекта создаёт свежий).
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreview(null);
      return;
    }
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  // Канал всегда открытый (тип не выбирается — радиогруппа только у группы):
  // состояние инициализируется по kind, чтобы UI не показывал одно, а отправлял
  // другое (находка валидатора #91).
  const [visibility, setVisibility] = useState<'closed' | 'open'>(
    kind === 'group' ? 'closed' : 'open',
  );
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState(DEFAULT_PERMISSIONS);
  const [pickQuery, setPickQuery] = useState('');

  const candidates = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    return (users?.items ?? []).filter(
      (u: UserListItem) =>
        u.id !== me?.id &&
        !memberIds.includes(u.id) &&
        (!q || u.displayName.toLowerCase().includes(q)),
    );
  }, [users, memberIds, pickQuery, me?.id]);

  function onAvatarPicked(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const issue = validateAvatarFile(file);
    if (issue) {
      toast.error(avatarIssueMessage(issue));
      return;
    }
    setAvatarFile(file);
  }

  async function submit() {
    const name = title.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    try {
      let conversation: ConversationListItem;
      try {
        conversation = await create.mutateAsync({
          type: kind,
          title: name,
          description: description.trim() || undefined,
          visibility,
          memberIds,
          permissions,
        });
      } catch {
        toast.error(ui.common.saveError);
        return;
      }
      // Аватар — после создания (эндпоинт беседы): сбой загрузки НЕ роняет
      // готовую беседу (тост об ошибке), аватар ставится кликом в топбаре.
      if (avatarFile) {
        try {
          await setAvatar.mutateAsync({ conversationId: conversation.id, file: avatarFile });
        } catch {
          toast.error(ui.common.saveError);
        }
      }
      onCreated(conversation.id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* #694: карточка не выходит за экран — шапка и футер закреплены,
          прокручивается только тело (оба раскрытых раздела дают ~900px). */}
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-5 pt-4 pr-12 pb-2">
          <DialogTitle>
            {kind === 'group' ? ui.chat.createGroupChat : ui.chat.createChannel}
          </DialogTitle>
        </DialogHeader>
        {/* min-w-0 (#277, ловушка field-sizing+grid): без него прямые grid-дети
            DialogContent получают авто-минимум = min-content Textarea, и
            длинная однострочная подпись/описание распирает окно. */}
        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto px-5 pb-2">
          <div className="flex items-center gap-3">
            {/* Аватарка группы/канала (#186): выбор файла сразу (превью в
                кнопке, «×» сбрасывает), загрузка после создания беседы;
                без файла — цветная заглушка из инициалов. */}
            <div className="relative size-14 shrink-0">
              <button
                type="button"
                onClick={() => avatarInputRef.current?.click()}
                aria-label={avatarPreview ? ui.common.avatarChange : ui.common.avatarUpload}
                title={avatarPreview ? ui.common.avatarChange : ui.common.avatarUpload}
                className="group flex size-14 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
              >
                {avatarPreview ? (
                  <img src={avatarPreview} alt="" className="size-full object-cover" />
                ) : (
                  <Camera className="size-5" strokeWidth={1.75} />
                )}
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  <Camera className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
              </button>
              {avatarPreview ? (
                <button
                  type="button"
                  onClick={() => setAvatarFile(null)}
                  aria-label={ui.common.avatarRemove}
                  title={ui.common.avatarRemove}
                  className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border hover:text-foreground"
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              ) : null}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={onAvatarPicked}
                aria-hidden
                tabIndex={-1}
              />
            </div>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={ui.chat.chatTitlePlaceholder}
              aria-label={ui.chat.chatTitlePlaceholder}
              className="h-10 text-sm"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <NodeLabel label={ui.chat.participants} />
              <span className="text-xs text-muted-foreground">{ui.chat.participantsHint}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border px-2 py-1.5">
              {me ? (
                <span className="flex items-center gap-1.5 rounded-md bg-accent px-1.5 py-1 text-xs font-medium">
                  <PersonAvatarById
                    userId={me.id}
                    name={me.displayName}
                    decorative
                    className="size-4"
                  />
                  {withoutPatronymic(me.displayName)}
                </span>
              ) : null}
              {memberIds.map((id) => {
                const person = users?.items.find((u: UserListItem) => u.id === id);
                if (!person) return null;
                return (
                  <span
                    key={id}
                    className="flex items-center gap-1.5 rounded-md bg-accent px-1.5 py-1 text-xs font-medium"
                  >
                    <PersonAvatar
                      name={person.displayName}
                      avatarUrl={person.avatarUrl}
                      decorative
                      className="size-4"
                    />
                    {withoutPatronymic(person.displayName)}
                    <button
                      type="button"
                      onClick={() => setMemberIds(memberIds.filter((m) => m !== id))}
                      aria-label={ui.chat.removeParticipant}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" strokeWidth={2} />
                    </button>
                  </span>
                );
              })}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 px-1.5 py-1 text-xs font-medium text-info hover:underline"
                  >
                    <Plus className="size-3" strokeWidth={2} />
                    {ui.chat.addParticipant}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-1">
                  <Input
                    value={pickQuery}
                    onChange={(e) => setPickQuery(e.target.value)}
                    placeholder={ui.chat.participantSearch}
                    aria-label={ui.chat.participantSearch}
                    className="h-8 mb-1 text-sm"
                  />
                  <div className="flex max-h-52 flex-col overflow-y-auto" data-no-scrollbar>
                    {candidates.map((person: UserListItem) => (
                      <button
                        key={person.id}
                        type="button"
                        onClick={() => setMemberIds([...memberIds, person.id])}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <PersonAvatar
                          name={person.displayName}
                          avatarUrl={person.avatarUrl}
                          decorative
                          className="size-6"
                        />
                        <span className="truncate">{withoutPatronymic(person.displayName)}</span>
                      </button>
                    ))}
                    {candidates.length === 0 ? (
                      <span className="px-2 py-3 text-center text-xs text-muted-foreground">
                        {ui.chat.forwardEmpty}
                      </span>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <CreateSection title={ui.chat.chatSettingsSection}>
            {kind === 'group' ? (
              <div
                role="radiogroup"
                aria-label={ui.chat.chatTypeLabel}
                className="flex flex-col gap-3"
              >
                <TypeRadio
                  checked={visibility === 'closed'}
                  title={ui.chat.chatTypeClosed}
                  hint={ui.chat.chatTypeClosedHint}
                  onSelect={() => setVisibility('closed')}
                />
                <TypeRadio
                  checked={visibility === 'open'}
                  title={ui.chat.chatTypeOpen}
                  hint={ui.chat.chatTypeOpenHint}
                  onSelect={() => setVisibility('open')}
                />
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">{ui.chat.channelOpenHint}</span>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {ui.chat.descriptionLabel}
              </span>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={ui.chat.descriptionPlaceholder}
                rows={3}
                className="resize-none text-sm"
              />
            </label>
          </CreateSection>

          <CreateSection title={ui.chat.permissionsSection}>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {ui.chat.moderatorsLabel}
              </span>
              <button
                type="button"
                onClick={() => toast(ui.chat.actionSoon)}
                className="w-fit px-1.5 py-1 text-xs font-medium text-info hover:underline"
              >
                + {ui.chat.addModerator}
              </button>
            </div>
            {(Object.keys(DEFAULT_PERMISSIONS) as PermKey[]).map((key) => (
              <RoleSelect
                key={key}
                permKey={key}
                value={permissions[key]}
                onChange={(role) => setPermissions({ ...permissions, [key]: role })}
              />
            ))}
          </CreateSection>
        </div>
        <DialogFooter className="px-5 pb-4 pt-3">
          <Button variant="ghost" onClick={onClose}>
            {ui.common.cancel}
          </Button>
          <Button
            variant="secondary"
            disabled={!title.trim() || submitting || create.isPending}
            onClick={() => void submit()}
          >
            {ui.chat.createSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
