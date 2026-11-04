import { Maximize2 } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';

/**
 * «Открыть на весь экран» внутри вкладки-просмотрщика (вердикт владельца
 * 04.11.2026): кнопка живёт у зума вложения (панель PDF, нижний правый угол
 * ONLYOFFICE, поверх медиа/текста), а не на общей полосе карточки.
 * Оформление — ТАКОЕ ЖЕ, как у «+»/«−» зума: ghost-иконка без подложки и
 * рамки (вердикт 04.11.2026: «чисто значок»), чтобы не читалась отдельной
 * кнопкой на тёмной панели.
 */
export function ViewerFullscreenButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={onClick}
      aria-label={ui.files.fullscreen}
      title={ui.files.fullscreen}
      className={className}
    >
      <Maximize2 />
    </Button>
  );
}
