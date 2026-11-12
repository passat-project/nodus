import { Avatar, AvatarFallback, AvatarImage } from '@nodus/ui/components/avatar';
import { cn } from '@nodus/ui/lib/utils';

import { usePersonAvatarUrl } from './use-person-avatar-url.js';

function initialsOf(name: string): string {
  // Инициалы берём только от слов, начинающихся с БУКВЫ: названия вида
  // «Витрина (проба…)» не должны давать глиф «В(» (визуальный гейт #211).
  const letters = name.split(' ').filter((part) => /\p{L}/u.test(part[0] ?? ''));
  const source = letters.length > 0 ? letters : [name];
  return source
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

/** Графитовая палитра «Инструмента»: оттенки серого, без семантики в цвете. */
const PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: '#26262b', fg: '#d9d9d6' },
  { bg: '#303036', fg: '#e8e8e6' },
  { bg: '#3a3a41', fg: '#e8e8e6' },
  { bg: '#45454d', fg: '#f0f0ee' },
  { bg: '#d9d9d6', fg: '#0a0a0b' },
];

/** Детерминированный тон аватара от имени. */
export function toneOf(name: string): { bg: string; fg: string } {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0]!;
}

interface PersonAvatarProps {
  name: string;
  /** Готовый url фото (DTO сущности: сообщение, участник, карточка). */
  avatarUrl?: string | null;
  className?: string;
  /** Кегль инициалов-заглушки (по умолчанию text-xs): для большого фото
   *  профиля — крупнее (например, text-4xl). */
  fallbackClass?: string;
  /** Декоративный аватар: рядом уже есть имя автора (видимое или sr-only) или
   *  подпись кнопки — фото и инициалы скрываются от скринридера (alt="" +
   *  aria-hidden), чтобы имя не читалось дважды. */
  decorative?: boolean;
  /** Всплывающая подсказка (native title). По умолчанию — имя сотрудника:
   *  владелец попросил, чтобы у ЛЮБОГО аватара при наведении читались имя и
   *  фамилия (#728) — рейка, карточки канбана, списки, участники, уведомления.
   *  Пустая строка подсказку выключает (аватар рядом с видимым именем). */
  title?: string;
}

/**
 * Аватар сотрудника — ОДИН компонент на портал (#726): фото, а без фото —
 * графитовые инициалы (`toneOf`). Визуал не зависит от наличия фото (тот же
 * размер и скругление), поэтому подстановка фото не двигает пузыри/строки.
 *
 * Данные приходят снаружи — из DTO, где поле уже есть (`author.avatarUrl`,
 * `member.user.avatarUrl`, `card.avatarUrl`). Экранам без поля (топбар,
 * чипы создания чата) — `PersonAvatarById`: единственный источник id → кэш
 * справочника (`use-person-avatar-url.ts`).
 */
export function PersonAvatar({
  name,
  avatarUrl,
  className,
  fallbackClass,
  decorative = false,
  title,
}: PersonAvatarProps) {
  const tone = toneOf(name);
  const hidden = decorative ? true : undefined;
  // Подсказка по умолчанию — имя: hover по любому аватару называет человека.
  const tooltip = title ?? name;
  return (
    <Avatar title={tooltip || undefined} className={cn('size-8 ring-1 ring-border', className)}>
      {avatarUrl ? (
        <AvatarImage
          src={avatarUrl}
          // Декоративный — пустой alt: имя уже озвучено рядом (без дубля).
          alt={decorative ? '' : name}
          aria-hidden={hidden}
        />
      ) : null}
      <AvatarFallback
        className={cn('text-xs font-semibold', fallbackClass)}
        style={{ backgroundColor: tone.bg, color: tone.fg }}
        aria-hidden={hidden}
      >
        {initialsOf(name)}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * Аватар по одному id, без готового `avatarUrl` в руках (#726): фото берётся
 * из единого кэша справочника (`usePersonAvatarUrl`) — запрос не создаётся,
 * справочник уже загружен оболочкой (палитра Ctrl+K). Нет фото — инициалы.
 */
export function PersonAvatarById({
  userId,
  name,
  ...rest
}: Omit<PersonAvatarProps, 'avatarUrl'> & { userId: string | null | undefined }) {
  const avatarUrl = usePersonAvatarUrl(userId);
  return <PersonAvatar name={name} avatarUrl={avatarUrl} {...rest} />;
}
