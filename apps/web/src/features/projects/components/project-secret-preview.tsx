import type { ProjectSecretPreview } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

/**
 * Предпросмотр перевода проекта в секретный (#541, решение владельца п.4):
 * до подтверждения руководитель видит, кто останется участником (роли задач
 * и решающие) и кто потеряет доступ (наблюдатели задач вне состава и
 * самовступившие). Без загруженного превью и отметки подтверждения
 * сохранение видимости заблокировано — видимая часть решения владельца.
 */
export function ProjectSecretPreviewBlock({
  preview,
  loading,
  error,
  confirmed,
  onConfirmChange,
}: {
  preview: ProjectSecretPreview | undefined;
  loading: boolean;
  error: boolean;
  confirmed: boolean;
  onConfirmChange: (confirmed: boolean) => void;
}) {
  const strings = ui.projects.secretPreview;
  if (loading) return <p className="text-sm text-muted-foreground">{strings.loading}</p>;
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {strings.error}
      </p>
    );
  }
  if (!preview) return null;
  const empty = preview.willBecomeMembers.length === 0 && preview.willLoseAccess.length === 0;
  return (
    <section className="rounded-lg border border-border bg-accent/30 px-3 py-2.5 text-sm">
      <p className="font-medium">{strings.title}</p>
      <p className="mt-1 text-muted-foreground">{strings.hint}</p>
      {empty ? (
        <p className="mt-2 text-muted-foreground">{strings.empty}</p>
      ) : (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-label-sm tracking-[0.08em] text-muted-foreground uppercase">
              {strings.willBecome}
            </p>
            <ul className="mt-1 space-y-0.5">
              {preview.willBecomeMembers.map((item) => (
                <li key={item.user.id}>
                  <span className="font-medium">{item.user.displayName}</span>
                  {' — '}
                  {item.roles.map((role) => strings.roles[role]).join(', ')}
                  {' · '}
                  {strings.tasksCount.replace('{count}', String(item.taskCount))}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-label-sm tracking-[0.08em] text-muted-foreground uppercase">
              {strings.willLose}
            </p>
            <ul className="mt-1 space-y-0.5">
              {preview.willLoseAccess.map((item) => (
                <li key={`${item.user.id}:${item.kind}`}>
                  <span className="font-medium">{item.user.displayName}</span>
                  {' — '}
                  {strings.loseKind[item.kind]}
                  {item.taskCount > 0
                    ? ` · ${strings.tasksCount.replace('{count}', String(item.taskCount))}`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <label className="mt-3 flex items-start gap-2">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onConfirmChange(event.target.checked)}
          className="mt-0.5 size-4 accent-port"
        />
        <span>{strings.confirm}</span>
      </label>
    </section>
  );
}
