/** Смысл кнопки (#430) — вынесено из ru-automation.ts (I5). */
export const intentStrings = {
  intent: 'Смысл кнопки',
  intentSegments: { action: 'Ждёт действия', service: 'Служебная' },
  intentActionHint: 'Кнопка ждёт нажатия человека — попадёт в «Мои действия»',
  intentServiceHint: 'Служебная кнопка — в «Мои действия» не попадёт',
} as const;
