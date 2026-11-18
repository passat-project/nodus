import type { BaselineSnapshot } from './eval-report.js';

/**
 * Baseline «до» (#926): исходный каталог `main@04b6dbd0` (41 инструмент),
 * исходные 100 кейсов золотого набора, тот же скорер `retrieval@1.0.0`.
 *
 * Замер снят в отдельном worktree на коммите `04b6dbd0`: на main ещё нет
 * eval-конвейера, поэтому туда скопированы `eval/`, `retrieval*` и
 * `tool-definition` этой ветки, а каталог остался исходным. Числа
 * воспроизводимы: тот же прогон, отличаются только каталог и описания.
 */
export const BASELINE: BaselineSnapshot = {
  source: 'main@04b6dbd0, каталог 41 инструмент, исходные 100 кейсов',
  retrievalVersion: '1.0.0',
  caseCount: 100,
  catalogSize: 41,
  router: {
    recallAt7: 0.9008264462809917,
    allExpectedAt7: 0.8607594936708861,
    wrongToolRate: 0.0379746835443038,
    forbiddenShelfRate: 0.24050632911392406,
    refusalAccuracy: 1,
    clarifySafety: 0.8333333333333334,
    top1Accuracy: 0.7848101265822784,
  },
  search: {
    recallAt7: 0.743801652892562,
    allExpectedAt7: 0.6455696202531646,
    wrongToolRate: 0.0379746835443038,
    forbiddenShelfRate: 0.4936708860759494,
    refusalAccuracy: 0.7333333333333333,
    clarifySafety: 1,
    top1Accuracy: 0.569620253164557,
  },
  byRole: {
    gip: {
      cases: 22,
      router: {
        recallAt7: 0.896551724137931,
        allExpectedAt7: 0.8823529411764706,
        wrongToolRate: 0,
        forbiddenShelfRate: 0.058823529411764705,
        refusalAccuracy: 1,
        clarifySafety: 1,
        top1Accuracy: 0.7647058823529411,
      },
    },
    secretary: {
      cases: 28,
      router: {
        recallAt7: 0.8823529411764706,
        allExpectedAt7: 0.8260869565217391,
        wrongToolRate: 0.043478260869565216,
        forbiddenShelfRate: 0.21739130434782608,
        refusalAccuracy: 1,
        clarifySafety: 0.5,
        top1Accuracy: 0.782608695652174,
      },
    },
    admin: {
      cases: 28,
      router: {
        recallAt7: 0.967741935483871,
        allExpectedAt7: 0.9545454545454546,
        wrongToolRate: 0,
        forbiddenShelfRate: 0.2727272727272727,
        refusalAccuracy: 1,
        clarifySafety: 1,
        top1Accuracy: 0.8636363636363636,
      },
    },
    employee: {
      cases: 22,
      router: {
        recallAt7: 0.8518518518518519,
        allExpectedAt7: 0.7647058823529411,
        wrongToolRate: 0.11764705882352941,
        forbiddenShelfRate: 0.4117647058823529,
        refusalAccuracy: 1,
        clarifySafety: 1,
        top1Accuracy: 0.7058823529411765,
      },
    },
  },
};
