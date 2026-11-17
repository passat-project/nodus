import type { GoldenCase } from '../golden-set.types.js';
import { ADMIN_CASES_1 } from './admin-cases-1.js';
import { ADMIN_CASES_2 } from './admin-cases-2.js';
import { BATCH_927_CASES } from './batch-927.js';
import { BATCH_928_CASES } from './batch-928.js';
import { BATCH_929_CASES } from './batch-929.js';
import { BATCH_930_CASES } from './batch-930.js';
import { EMPLOYEE_CASES_1 } from './employee-cases-1.js';
import { EMPLOYEE_CASES_2 } from './employee-cases-2.js';
import { GIP_CASES_1 } from './gip-cases-1.js';
import { GIP_CASES_2 } from './gip-cases-2.js';
import { SECRETARY_CASES_1 } from './secretary-cases-1.js';
import { SECRETARY_CASES_2 } from './secretary-cases-2.js';

/** Золотой набор #926: 120 запросов четырёх ролей. */
export const GOLDEN_SET: readonly GoldenCase[] = [
  ...GIP_CASES_1,
  ...GIP_CASES_2,
  ...SECRETARY_CASES_1,
  ...SECRETARY_CASES_2,
  ...ADMIN_CASES_1,
  ...ADMIN_CASES_2,
  ...EMPLOYEE_CASES_1,
  ...EMPLOYEE_CASES_2,
  ...BATCH_927_CASES,
  ...BATCH_928_CASES,
  ...BATCH_929_CASES,
  ...BATCH_930_CASES,
];
