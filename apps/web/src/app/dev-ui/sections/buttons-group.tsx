import { Fragment } from 'react';
import { devUiStrings, ui } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { cn } from '@nodus/ui/lib/utils';
import { MoreHorizontal, Plus, Search } from 'lucide-react';

import { DevGroup } from '../dev-section.js';
import {
  BUTTON_SIZES,
  BUTTON_STATE_CLASS,
  BUTTON_STATES,
  BUTTON_VARIANTS,
  type ButtonStateId,
  type ButtonVariantId,
} from '../dev-ui-tokens.js';

const VARIANT_LABEL: Record<ButtonVariantId, string> = {
  default: devUiStrings.controls.variantDefault,
  outline: devUiStrings.controls.variantOutline,
  secondary: devUiStrings.controls.variantSecondary,
  ghost: devUiStrings.controls.variantGhost,
  destructive: devUiStrings.controls.variantDestructive,
  link: devUiStrings.controls.variantLink,
};

const STATE_LABEL: Record<ButtonStateId, string> = {
  default: devUiStrings.controls.stateDefault,
  hover: devUiStrings.controls.stateHover,
  active: devUiStrings.controls.stateActive,
  focus: devUiStrings.controls.stateFocus,
  disabled: devUiStrings.controls.stateDisabled,
};

/** Принудительный класс состояния (зеркало cva — см. dev-ui-tokens.ts). */
function forcedClass(variant: ButtonVariantId, state: ButtonStateId): string | undefined {
  if (state === 'default' || state === 'disabled') return undefined;
  return BUTTON_STATE_CLASS[variant][state];
}

/**
 * Ф4: Button — все варианты × все состояния. Матрица статична (для кадров), но
 * кнопки настоящие: рядом с «нарисованным» ховером владелец проверит живой,
 * Tab доводит до focus-visible, disabled — реальный атрибут.
 */
export function ButtonsGroup() {
  return (
    <div className="grid min-w-0 gap-4">
      <DevGroup
        title={devUiStrings.controls.buttons}
        hint={devUiStrings.controls.buttonsHint}
        caption={devUiStrings.controls.captionButtons}
      >
        {/* Матрица состояний — в своём скролл-контейнере (канон таблиц: px-треки,
            w-max min-w-full, overflow-x-auto). min-w-0/max-w-full обязательны:
            иначе max-content матрицы становится min-content страницы и рейка
            шелла отжимается (замечание владельца). */}
        <div className="min-w-0 max-w-full overflow-x-auto">
          <div className="grid w-max min-w-full grid-cols-[6.5rem_repeat(5,minmax(4rem,max-content))] items-center gap-2">
            <span />
            {BUTTON_STATES.map((state) => (
              <span key={state} className="font-mono text-label-xs text-muted-foreground">
                {STATE_LABEL[state]}
              </span>
            ))}
            {BUTTON_VARIANTS.map((variant) => (
              <Fragment key={variant}>
                <span className="text-label-sm text-muted-foreground">
                  {VARIANT_LABEL[variant]}
                </span>
                {BUTTON_STATES.map((state) => (
                  <Button
                    key={state}
                    variant={variant}
                    disabled={state === 'disabled'}
                    className={cn('w-full', forcedClass(variant, state))}
                  >
                    {VARIANT_LABEL[variant]}
                  </Button>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      </DevGroup>

      <DevGroup title={devUiStrings.controls.sizes} caption={devUiStrings.controls.captionSizes}>
        <div className="flex flex-wrap items-end gap-3">
          {BUTTON_SIZES.map(({ size }) => (
            <div key={size} className="flex flex-col items-start gap-1.5">
              <Button size={size}>
                <Plus />
                {VARIANT_LABEL.default}
              </Button>
              <span className="font-mono text-label-xs text-muted-foreground">{size}</span>
            </div>
          ))}
          <div className="flex flex-col items-start gap-1.5">
            <div className="flex items-center gap-2">
              <Button size="icon" variant="ghost" aria-label={ui.common.search}>
                <Search />
              </Button>
              <Button size="icon-sm" variant="outline" aria-label={ui.common.viewSettings}>
                <MoreHorizontal />
              </Button>
            </div>
            <span className="font-mono text-label-xs text-muted-foreground">icon · icon-sm</span>
          </div>
        </div>
      </DevGroup>
    </div>
  );
}
