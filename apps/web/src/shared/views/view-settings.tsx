import { useState } from 'react';
import { Settings2 } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nodus/ui/components/dropdown-menu';
import { Input } from '@nodus/ui/components/input';

import {
  useViewFields,
  type FieldDef,
  type FieldGroup,
  type ViewField,
} from './use-view-fields.js';

/** С какого размера реестра показываем поиск по названию: короткий список
 *  читается глазами, длинный (атрибутов до 1000) — только поиском. */
export const VIEW_FIELDS_SEARCH_THRESHOLD = 8;

/** Группа полей в шестерёнке вида: системные поля модуля и атрибуты (#632).
 *  `enabled` — сколько полей группы включено (счётчик у заголовка). */
export interface ViewFieldGroup {
  id: FieldGroup;
  title: string;
  fields: ViewField<FieldDef>[];
  enabled: number;
}

/**
 * Группы шестерёнки вида (#632): «Отображаемые поля» (реестр модуля) и
 * «Атрибуты» (колонки/блоки из реестра атрибутов) — с поиском по названию.
 * Пустая группа не рисуется: реестр без атрибутов не показывает заголовок
 * «Атрибуты»; поиск без совпадений — «Ничего не найдено» у вызывающего.
 * Чистая функция — тестируется без DOM.
 */
export function groupViewFields(
  fields: readonly ViewField<FieldDef>[],
  query = '',
): ViewFieldGroup[] {
  const needle = query.trim().toLocaleLowerCase('ru');
  const matched = fields.filter(
    (field) => needle.length === 0 || field.label.toLocaleLowerCase('ru').includes(needle),
  );
  const groups: { id: FieldGroup; title: string; fields: ViewField<FieldDef>[] }[] = [
    {
      id: 'system',
      title: ui.common.viewFields,
      fields: matched.filter((field) => field.group !== 'attributes'),
    },
    {
      id: 'attributes',
      title: ui.formulas.views.group,
      fields: matched.filter((field) => field.group === 'attributes'),
    },
  ];
  return groups
    .filter((group) => group.fields.length > 0)
    .map((group) => ({
      ...group,
      enabled: group.fields.filter((field) => field.visible).length,
    }));
}

/**
 * Шестерёнка представления (единая для всех модулей): выбор отображаемых
 * полей из реестра модуля + сброс к дефолту. Ширина колонок регулируется
 * ручкой на границе хедера таблицы (ColumnResizer).
 *
 * Атрибуты (#632) — отдельная группа с поиском: реестр портала длинный,
 * атрибуты по умолчанию скрыты (список вида не раздувается). Счётчик
 * у заголовка группы — «включено/всего», видно, сколько колонок добавит
 * включение группы целиком.
 */
export function ViewSettings({ viewKey, defs }: { viewKey: string; defs: FieldDef[] }) {
  const { fields, toggleField, reset } = useViewFields(viewKey, defs);
  const [query, setQuery] = useState('');
  const groups = groupViewFields(fields, query);
  const searchable = fields.length >= VIEW_FIELDS_SEARCH_THRESHOLD;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        // Поиск живёт в рамках открытой шестерёнки: закрыли — чистый список.
        if (!open) setQuery('');
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={ui.common.viewSettings}
          className="text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Settings2 />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {searchable ? (
          // Поле поиска липнет к верху прокручиваемого списка. keydown
          // останавливаем: иначе Radix перехватывает стрелки/буквы типом
          // навигации меню и курсор уезжает из поля. Escape не глушим —
          // он закрывает меню (обработчик Radix выше по дереву).
          <div className="sticky top-0 z-10 bg-popover px-0.5 pt-0.5 pb-1">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') event.stopPropagation();
              }}
              placeholder={ui.common.searchPlaceholder}
              aria-label={ui.common.searchPlaceholder}
              className="h-7 text-sm"
            />
          </div>
        ) : null}
        {groups.length === 0 ? (
          <div className="px-1.5 py-1.5 text-body-xs text-muted-foreground">
            {ui.filters.notFound}
          </div>
        ) : null}
        {groups.map((group) => (
          <div key={group.id}>
            <div className="flex items-center justify-between gap-2 px-1.5 pt-1.5 pb-1">
              <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                {group.title}
              </span>
              <span
                className="shrink-0 font-mono text-label-sm text-muted-foreground tabular-nums"
                title={`${group.enabled} ${ui.formulas.views.count}`}
              >
                {group.enabled}/{group.fields.length}
              </span>
            </div>
            <DropdownMenuGroup>
              {group.fields.map((field) => (
                <DropdownMenuCheckboxItem
                  key={field.id}
                  checked={field.visible}
                  disabled={field.locked}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => toggleField(field.id, checked === true)}
                >
                  <span className="min-w-0 truncate" title={field.label}>
                    {field.label}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={reset}>{ui.common.resetView}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
