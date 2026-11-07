import type { FormulaNode, FormulaValidationIssue } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { toast } from 'sonner';

import type { useRemoveFormula, useSaveFormula, useValidateFormula } from './formula-api.js';
import { saveErrorText } from './formula-preview.js';

/** Сохранение и снятие формулы ячейки (#632, Р5/Р10): проверка перед
 *  записью, тосты, закрытие окна. Вынесено из состояния редактора. */
export function useFormulaSave({
  fieldId,
  parse,
  onClose,
  validate,
  save,
  remove,
  setIssues,
}: {
  fieldId: string;
  parse: { ast: FormulaNode | null; error: string | null };
  onClose: () => void;
  validate: ReturnType<typeof useValidateFormula>;
  save: ReturnType<typeof useSaveFormula>;
  remove: ReturnType<typeof useRemoveFormula>;
  setIssues: (issues: FormulaValidationIssue[]) => void;
}) {
  const handleSave = () => {
    if (!parse.ast) {
      toast.error(parse.error ?? ui.formulas.editor.syntaxError);
      return;
    }
    validate.mutate(
      { ast: parse.ast, targetFieldId: fieldId },
      {
        onSuccess: (response) => {
          if (!response.ok) {
            setIssues(response.issues.filter((issue) => issue.blocking));
            toast.error(ui.formulas.editor.saveError);
            return;
          }
          save.mutate(
            { fieldId, ast: parse.ast! },
            {
              onSuccess: () => {
                toast.success(ui.formulas.editor.saved);
                onClose();
              },
              onError: (error) => toast.error(saveErrorText(error)),
            },
          );
        },
        onError: () => toast.error(ui.formulas.editor.saveError),
      },
    );
  };

  const handleRemove = () => {
    remove.mutate(fieldId, {
      onSuccess: () => {
        toast.success(ui.formulas.editor.removed);
        onClose();
      },
      onError: (error) => toast.error(saveErrorText(error)),
    });
  };

  return { handleSave, handleRemove };
}
