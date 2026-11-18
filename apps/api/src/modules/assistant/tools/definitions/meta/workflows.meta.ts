import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания инструментов процессов (#926). */
export const workflowsMeta = {
  'workflows.process_types': {
    why: 'Показать типы процессов портала — виды поручений и виды писем с их категориями.',
    whenToUse:
      '«Какие типы процессов для задач настроены», «какие виды писем настроены в портале», «какие виды поручений есть», «в каком процессе создать задачу».',
    whenNotToUse:
      'Не для создания или публикации процесса и не для реестра писем (letters.list); это справочник настроенных видов.',
    subject: 'процесс',
    effect: 'read',
    example: { input: { category: 'letter', archived: 'exclude' }, note: 'виды писем портала' },
    returns: 'Типы процессов: название, категория (задача или письмо), системность, архивность.',
    nextStep: 'Назови вид так, как он записан в портале, и передай typeId в tasks.create.',
    intent: 'list',
  },
} satisfies Record<string, ToolStandard>;
