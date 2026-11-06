import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CustomFieldFormulaInfo,
  FormulaEvaluateResponse,
  FormulaHostKind,
  FormulaNode,
  FormulaResponse,
  FormulaValidateResponse,
} from '@nodus/contracts';

import { api } from '../../api-client.js';
import { projectsKeys } from '../../api/projects-list.js';
import { tasksKeys } from '../../api/tasks-keys.js';

/** Хост формулы: запись, у которой живёт ячейка (#632, Р10). У папки
 *  projectId обязателен — её маршрут живёт под проектом. */
export interface FormulaHost {
  kind: FormulaHostKind;
  id: string;
  /** Проект — для узла структуры (маршрут /projects/:id/nodes/:nodeId). */
  projectId?: string;
}

/** База REST-пути владельца хоста: мутации формул живут у владельца (I3). */
export function formulaHostPath(host: FormulaHost): string {
  switch (host.kind) {
    case 'task':
      return `/tasks/${host.id}`;
    case 'letter':
      return `/letters/${host.id}`;
    case 'project':
      return `/projects/${host.id}`;
    case 'node': {
      if (!host.projectId) throw new Error('formula host node requires projectId');
      return `/projects/${host.projectId}/nodes/${host.id}`;
    }
  }
}

export const formulaKeys = {
  all: ['custom-field-formulas'] as const,
  cell: (host: FormulaHost, fieldId: string) =>
    [...formulaKeys.all, host.kind, host.id, fieldId] as const,
};

/** Формульное состояние ячейки из DTO сущности (терпимо к старому API). */
export function formulaInfoOf(
  formulas: Record<string, CustomFieldFormulaInfo> | undefined,
  fieldId: string,
): CustomFieldFormulaInfo | undefined {
  return formulas?.[fieldId];
}

/** Собственная формула ячейки (AST) — по запросу редактора, не в списках. */
export function useFormulaCell(host: FormulaHost | null, fieldId: string, enabled: boolean) {
  return useQuery({
    queryKey: formulaKeys.cell(host ?? { kind: 'task', id: 'none' }, fieldId),
    queryFn: () =>
      api<FormulaResponse>(`${formulaHostPath(host!)}/custom-fields/${fieldId}/formula`),
    enabled: enabled && host !== null,
    staleTime: 0,
    // Каждое открытие редактора читает АКТУАЛЬНУЮ формулу: кэш после
    // save/remove может быть промежуточным ({ast:null}), а фоновый GET
    // обязан доехать и заполнить строку.
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });
}

/** После мутации формулы обновляем деталь хоста и его списки (значок fx и
 *  значение материализованы сервером). */
function invalidateHost(queryClient: ReturnType<typeof useQueryClient>, host: FormulaHost) {
  void queryClient.invalidateQueries({ queryKey: formulaKeys.all });
  switch (host.kind) {
    case 'task':
      void queryClient.invalidateQueries({ queryKey: tasksKeys.detail(host.id) });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.listPages() });
      void queryClient.invalidateQueries({ queryKey: tasksKeys.kanbanAll() });
      return;
    case 'letter':
      void queryClient.invalidateQueries({ queryKey: ['letters'] });
      return;
    case 'project':
      void queryClient.invalidateQueries({ queryKey: projectsKeys.detail(host.id) });
      void queryClient.invalidateQueries({ queryKey: projectsKeys.journals() });
      return;
    case 'node':
      void queryClient.invalidateQueries({ queryKey: projectsKeys.structures() });
      if (host.projectId) {
        void queryClient.invalidateQueries({ queryKey: projectsKeys.detail(host.projectId) });
      }
      return;
  }
}

/** Сохранить/заменить свою формулу ячейки (PUT у владельца хоста). */
export function useSaveFormula(host: FormulaHost) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { fieldId: string; ast: FormulaNode }) =>
      api<FormulaResponse>(`${formulaHostPath(host)}/custom-fields/${vars.fieldId}/formula`, {
        method: 'PUT',
        body: { ast: vars.ast },
      }),
    onSuccess: async (_data, vars) => {
      // GET, начатый до сохранения, не должен перетереть кэш старым AST
      // (иначе повторное открытие редактора показывает пустую формулу).
      const key = formulaKeys.cell(host, vars.fieldId);
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, { ast: vars.ast, origin: 'own' });
      invalidateHost(queryClient, host);
    },
  });
}

/** Снять формулу: последнее вычисленное значение остаётся снимком (Р5). */
export function useRemoveFormula(host: FormulaHost) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fieldId: string) =>
      api<void>(`${formulaHostPath(host)}/custom-fields/${fieldId}/formula`, {
        method: 'DELETE',
      }),
    onSuccess: async (_data, fieldId) => {
      const key = formulaKeys.cell(host, fieldId);
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, { ast: null });
      invalidateHost(queryClient, host);
    },
  });
}

/** Превью/проверка без записи (редактор). */
export function useEvaluateFormula(host: FormulaHost) {
  return useMutation({
    mutationFn: (ast: FormulaNode) =>
      api<FormulaEvaluateResponse>('/custom-fields/formulas/evaluate', {
        method: 'POST',
        body: { ast, context: { hostKind: host.kind, hostId: host.id } },
      }),
  });
}

export function useValidateFormula(host: FormulaHost) {
  return useMutation({
    mutationFn: (vars: { ast: FormulaNode; targetFieldId?: string; typeDefault?: boolean }) =>
      api<FormulaValidateResponse>('/custom-fields/formulas/validate', {
        method: 'POST',
        body: {
          ast: vars.ast,
          hostKind: host.kind,
          ...(vars.targetFieldId ? { targetFieldId: vars.targetFieldId } : {}),
          ...(vars.typeDefault ? { typeDefault: true } : {}),
        },
      }),
  });
}
