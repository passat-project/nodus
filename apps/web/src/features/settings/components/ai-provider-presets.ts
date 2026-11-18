import { ASSISTANT_PROVIDER_PRESETS, ui } from '@nodus/contracts';

const strings = ui.assistant.settings;

/** Пресеты окна создания: готовые провайдеры + свой адрес, выбором строками. */
export const providerPresetOptions = [
  ...ASSISTANT_PROVIDER_PRESETS.map((preset) => ({
    value: preset.key as string,
    label: preset.name,
    hint: preset.baseUrl,
  })),
  { value: 'custom', label: strings.presetCustom, hint: strings.presetCustomHint },
];
