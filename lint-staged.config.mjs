const quote = (file) => `"${file}"`;

// Фикстуры тестов линтера заведомо нарушают правила — их нельзя отдавать
// в eslint/prettier даже когда они попадают в staged (ESLint 10 линтует
// явно переданные файлы вопреки ignore-паттернам).
const isLintable = (file) => !file.replaceAll('\\', '/').includes('tests/lint/fixtures/');

const runOn = (commands) => (files) => {
  const targets = files.filter(isLintable);
  if (targets.length === 0) return [];
  const joined = targets.map(quote).join(' ');
  return commands.map((cmd) => `${cmd} ${joined}`);
};

export default {
  '*.{ts,tsx,mts,cts,js,mjs,cjs}': runOn(['eslint --fix', 'prettier --write']),
  '*.{json,md,yml,yaml,css,html}': runOn(['prettier --write']),
  // Инкубатор — очередь идей с жёстким бюджетом: лимиты и обязательные поля
  // проверяются до коммита, чтобы файл не разрастался незаметно.
  'docs/product/{incubator.md,incubator-archive.md,incubator/*.md}': () =>
    'node scripts/check-incubator.mjs',
};
