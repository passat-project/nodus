import { useRef, useState } from 'react';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';

/**
 * Инлайн-создание портфеля в левой колонке журнала (#559): одна строка поля
 * на месте списка папок (модель «Создать в конце ряда»), Enter — создать,
 * Esc — отмена. Окно не открывается: папка — лёгкая сущность журнала.
 */
export function PortfolioCreateField({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  // Enter + blur не должны создать две папки: действие строки одноразовое.
  const settled = useRef(false);
  const trimmed = name.trim();

  const finish = (submit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (submit && trimmed) onSubmit(trimmed);
    else onCancel();
  };

  return (
    <Input
      autoFocus
      value={name}
      onChange={(event) => setName(event.target.value)}
      placeholder={ui.projects.portfolioNamePlaceholder}
      aria-label={ui.projects.portfolioCreate}
      className="h-8 text-sm"
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        }
      }}
    />
  );
}
