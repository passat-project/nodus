import type { LetterRelationKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import { ModeChoices } from '../../../../shared/ui/panel/panel-kit.js';

/** Направление связи (#611): чьё письмо получает связь. */
export type RelationDirection = 'fromCurrent' | 'toCurrent';

/**
 * Два выбора окна связи: вид («Ответ на» / «Вложено в») и направление.
 * Вынесено из окна ради лимита I5; подсказки видов зависят от направления —
 * в обратном режиме выбранное письмо становится ребёнком, а не родителем.
 */
export function RelationModeChoices({
  kind,
  direction,
  disabled,
  onKind,
  onDirection,
}: {
  kind: LetterRelationKind;
  direction: RelationDirection;
  disabled: boolean;
  onKind: (kind: LetterRelationKind) => void;
  onDirection: (direction: RelationDirection) => void;
}) {
  const fromCurrent = direction === 'fromCurrent';
  const kinds = [
    {
      value: 'reply_to' as const,
      label: ui.letters.relations.kindReplyTo,
      hint: fromCurrent
        ? ui.letters.relations.kindReplyToHint
        : ui.letters.relations.directionToCurrentHint,
    },
    {
      value: 'nested_in' as const,
      label: ui.letters.relations.kindNestedIn,
      hint: fromCurrent
        ? ui.letters.relations.kindNestedInHint
        : ui.letters.relations.directionToCurrentHint,
    },
  ];
  const directions = [
    {
      value: 'fromCurrent' as const,
      label: ui.letters.relations.directionFromCurrent,
      hint: ui.letters.relations.directionFromCurrentHint,
    },
    {
      value: 'toCurrent' as const,
      label: ui.letters.relations.directionToCurrent,
      hint: ui.letters.relations.directionToCurrentHint,
    },
  ];
  return (
    <>
      <ModeChoices
        value={kind}
        options={kinds}
        disabled={disabled}
        ariaLabel={ui.letters.relations.kindLabel}
        onChange={onKind}
      />
      {/* Направление (#611): «вложить в этот конверт уже зарегистрированное
          письмо» — без ухода с карточки; предпросмотр показывает местами. */}
      <ModeChoices
        value={direction}
        options={directions}
        disabled={disabled}
        ariaLabel={ui.letters.relations.directionLabel}
        onChange={onDirection}
      />
    </>
  );
}
