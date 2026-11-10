import type { WorkflowDetail, WorkflowDraftDocument } from '@nodus/contracts';

import { canonicalDocument, structureChanged } from './route-doc-helpers.js';
import { adoptSavedLayout, layoutFingerprint } from './route-doc-layout.js';
import { EMPTY_LAYOUT, layoutOf } from './route-doc-ops.js';
import { readDraft, readStaleDraft } from './route-draft-storage.js';

/**
 * Состояние рабочей копии из документа сервера. Черновик той же версии —
 * подхватывается (баннер «Сбросить», если в нём правки маршрута;
 * несохранённую расстановку из него автосохранение отправит само);
 * устаревший — игнорируется, но о нём сообщаем (staleDraftAt).
 * Baseline и документ канонизируются ОДНОЙ функцией: сервер отдаёт
 * глобальный sortOrder, клиент после правок — групповой; без этого
 * сравнение видело ложную разницу и вход показывал «есть изменения» (#409).
 */
export function loadedState(detail: WorkflowDetail) {
  const baseline = canonicalDocument({
    stages: detail.document.stages.map((s) => ({ ...s })),
    transitions: detail.document.transitions.map((t) => ({ ...t })),
    // Действия без смены статуса (#633): раздел документа, как переходы.
    // Без него рабочая копия теряла опубликованные действия при загрузке.
    actions: (detail.document.actions ?? []).map((a) => ({ ...a })),
    layout: detail.document.layout ?? EMPTY_LAYOUT,
    // Форма создания — раздел документа (#432): null — форма по умолчанию.
    creation: detail.document.creation ?? null,
  });
  const draft = readDraft(detail.id, detail.version);
  const document = canonicalDocument(
    draft
      ? {
          ...draft.document,
          actions: draft.document.actions ?? [],
          layout: layoutOf(draft.document),
        }
      : baseline,
  );
  return {
    workflowId: detail.id,
    baseVersion: detail.version,
    baseline,
    document,
    draftSavedAt: draft?.savedAt ?? null,
    staleDraftAt: draft ? null : readStaleDraft(detail.id, detail.version),
    selection: null,
    dirty: structureChanged(document, baseline),
    past: [],
    future: [],
    pendingReload: false,
  };
}

/**
 * Та же версия, сменилась только расстановка (чужое автосохранение,
 * `workflow.layout_changed`): общая раскладка приходит в открытый
 * редактор, свои неотправленные места остаются. Шагом истории не считается.
 * `null` — менять нечего.
 */
export function adoptedLayoutState(
  state: { document: WorkflowDraftDocument; baseline: WorkflowDraftDocument },
  detail: WorkflowDetail,
): { document: WorkflowDraftDocument; baseline: WorkflowDraftDocument } | null {
  const server = detail.document.layout;
  if (!server || layoutFingerprint(server) === layoutFingerprint(state.baseline.layout)) {
    return null;
  }
  return {
    baseline: { ...state.baseline, layout: server },
    document: {
      ...state.document,
      layout: adoptSavedLayout(state.document.layout, state.baseline.layout, server),
    },
  };
}
