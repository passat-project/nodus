import { Check, Mic, Square } from 'lucide-react';
import { ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';
import { toast } from 'sonner';

import { SendHexIcon } from '../ui/send-hex-icon.js';

/** Отправка/галка и мик — ОДИН габарит ghost-кнопки (size-8):
 *  переключение не двигает строку; заливки НЕТ — гексагон в
 *  семье значков, тон темнее (вердикт 24.09, раунды 4–5).
 *
 *  `running` — хост ведёт прогон (ассистент): в том же слоте красный
 *  квадрат «Остановить» (вердикт владельца 17.11.2026). `alwaysVisible` —
 *  хост показывает отправку всегда, даже на пустом поле. */
export function ComposerSendButton({
  sendVisible,
  editing,
  align,
  running = false,
  onStop,
  stopLabel,
  alwaysVisible = false,
}: {
  sendVisible: boolean;
  /** Режим правки — галка «Сохранить» вместо гексагона. */
  editing: boolean;
  align: string;
  /** Активный прогон: слот отправки — «Остановить» (красный квадрат). */
  running?: boolean;
  onStop?: () => void;
  /** Подпись «Остановить» из i18n ХОСТА (общий композер не знает модулей). */
  stopLabel?: string;
  /** Показывать отправку всегда (гексагон на пустом поле). */
  alwaysVisible?: boolean;
}) {
  if (running) {
    // Останов генерации — ОДНА заливная кнопка с солидным квадратом
    // (Exa-сверка 17.11.2026: 83% ИИ-интерфейсов заменяют «Отправить» на
    // «Стоп» тем же слотом; ChatGPT — чёрная заливка, Claude — оранжевая,
    // GitHub Copilot — красная; иконка — заполненный квадрат). Призрачная
    // иконка с подсветкой читалась как «чёрный квадрат в розовом»
    // (вердикт владельца), поэтому — заливка токеном destructive.
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          /* Квадрат — белый в ОБЕИХ темах: `destructive-foreground` в тёмной
             теме уходит в почти-чёрный и на красной заливке читался дыркой. */
          'shrink-0 rounded-full bg-destructive text-white hover:bg-destructive/90 hover:text-white',
          align,
        )}
        aria-label={stopLabel}
        title={stopLabel}
        onClick={onStop}
      >
        <Square className="size-3.5 fill-current" strokeWidth={0} />
      </Button>
    );
  }
  return sendVisible || alwaysVisible ? (
    <Button
      type="submit"
      variant="ghost"
      size="icon"
      /* Акцент info — тот же токен, что закреп/цитаты/бар
         пересылки (вердикт 24.09: «нравится цвет цитат и
         закрепов»; смена оттенка акцента = одна строка темы). */
      /* Акцент держится и в ховере: ghost-вариант красит текст в foreground,
         гексагон под курсором чернел (вердикт 17.11.2026). */
      className={cn('shrink-0 text-info hover:text-info', align)}
      aria-label={editing ? ui.common.save : ui.tasks.send}
      title={editing ? ui.common.save : ui.tasks.send}
    >
      {editing ? <Check className="size-5" strokeWidth={2} /> : <SendHexIcon className="size-5" />}
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('shrink-0 text-muted-foreground', align)}
      aria-label={ui.chat.voice}
      title={ui.chat.voice}
      onClick={() => toast(ui.chat.voiceSoon)}
    >
      <Mic strokeWidth={1.75} />
    </Button>
  );
}
