import type {
  PressConfigDraft,
  PressOrder,
  PressQuorum,
  ProcessCategory,
  WorkflowDraftTransition,
} from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';

import { useRouteDocStore } from '../../../model/route-doc-store.js';
import { PanelField, Segmented, SwitchRow } from '../../../../../shared/ui/panel/panel-kit.js';
import { PressSourcesEditor } from './press-source-editor.js';

/** Сводка раздела «Кнопку жмут несколько» в панели кнопки. */
export function pressSummary(transition: WorkflowDraftTransition): string {
  const press = transition.press;
  if (!press) return ui.automation.press.summaryOff;
  if (press.sources.length === 0) return ui.automation.press.summaryEmpty;
  const source =
    press.sources.length === 1
      ? ui.automation.press.sources[press.sources[0]!.kind]
      : `${ui.automation.press.sourcesLabel}: ${press.sources.length}`;
  return `${source} · ${ui.automation.press.quorum[press.quorum.kind]} · ${ui.automation.press.order[press.order]}`;
}

function defaultPress(): PressConfigDraft {
  return {
    sources: [{ kind: 'coexecutors' }],
    quorum: { kind: 'all' },
    order: 'parallel',
    excludeAuthor: true,
    statusLabels: { waiting: '', submitted: '' },
  };
}

/** Раздел кнопки «Кнопку жмут несколько» (#434, ADR-0025 п.5). */
export function TransitionPressSection({
  transition,
  readOnly,
  category,
}: {
  transition: WorkflowDraftTransition;
  readOnly: boolean;
  category: ProcessCategory;
}) {
  const patch = useRouteDocStore.getState().patchTransition;
  const press = transition.press;
  const set = (next: PressConfigDraft | null) => patch(transition.id, { press: next });

  if (!press) {
    return (
      <SwitchRow
        title={ui.automation.press.sectionTitle}
        checked={false}
        disabled={readOnly}
        onChange={() => set(defaultPress())}
      />
    );
  }

  const setQuorum = (kind: PressQuorum['kind']) => {
    const quorum: PressQuorum =
      kind === 'count'
        ? {
            kind: 'count',
            count: Math.max(1, press.quorum.kind === 'count' ? press.quorum.count : 2),
          }
        : { kind };
    set({ ...press, quorum });
  };

  return (
    <>
      <SwitchRow
        title={ui.automation.press.sectionTitle}
        checked
        disabled={readOnly}
        onChange={() => set(null)}
      />

      <PressSourcesEditor
        sources={press.sources}
        onChange={(sources) => set({ ...press, sources })}
        readOnly={readOnly}
        category={category}
      />

      <PanelField label={ui.automation.press.quorumLabel}>
        <Segmented
          value={press.quorum.kind}
          disabled={readOnly}
          options={[
            { value: 'all', label: ui.automation.press.quorum.all },
            { value: 'any', label: ui.automation.press.quorum.any },
            { value: 'count', label: ui.automation.press.quorum.count },
          ]}
          onChange={(kind) => setQuorum(kind as PressQuorum['kind'])}
        />
        {press.quorum.kind === 'count' ? (
          <Input
            type="number"
            min={1}
            max={100}
            value={press.quorum.count}
            disabled={readOnly}
            aria-label={ui.automation.press.quorumCountLabel}
            onChange={(event) =>
              set({ ...press, quorum: { kind: 'count', count: Number(event.target.value) } })
            }
          />
        ) : null}
      </PanelField>

      <PanelField label={ui.automation.press.orderLabel}>
        <Segmented
          value={press.order}
          disabled={readOnly}
          options={[
            { value: 'parallel', label: ui.automation.press.order.parallel },
            { value: 'sequential', label: ui.automation.press.order.sequential },
          ]}
          onChange={(order) => set({ ...press, order: order as PressOrder })}
        />
      </PanelField>

      <p className="text-xs text-muted-foreground">{ui.automation.press.windowHint}</p>

      <PanelField label={ui.automation.press.statusLabelsTitle}>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={press.statusLabels.waiting}
            placeholder={ui.tasks.press.waiting}
            aria-label={ui.automation.press.waitingLabel}
            maxLength={24}
            disabled={readOnly}
            onChange={(event) =>
              set({
                ...press,
                statusLabels: { ...press.statusLabels, waiting: event.target.value },
              })
            }
          />
          <Input
            value={press.statusLabels.submitted}
            placeholder={ui.tasks.press.submitted}
            aria-label={ui.automation.press.submittedLabel}
            maxLength={24}
            disabled={readOnly}
            onChange={(event) =>
              set({
                ...press,
                statusLabels: { ...press.statusLabels, submitted: event.target.value },
              })
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">{ui.automation.press.statusLabelsHint}</p>
      </PanelField>

      <SwitchRow
        title={ui.automation.press.excludeAuthorLabel}
        checked={press.excludeAuthor}
        disabled={readOnly}
        onChange={(excludeAuthor) => set({ ...press, excludeAuthor })}
      />
    </>
  );
}
