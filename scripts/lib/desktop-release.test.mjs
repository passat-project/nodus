// Тесты проверок выпуска (#562). Подписи синтетические: установщики в git не
// лежат (infra/desktop-dist в .gitignore), а проверяем мы не криптографию, а
// структуру .sig и соответствие манифесту. Публичный ключ — настоящий, из
// tauri.conf.json: именно с ним сверяется id ключа подписи.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareSemver, parseSig, pubkeyId, validateRelease } from './desktop-release.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tauriConf = JSON.parse(
  readFileSync(resolve(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
);
const pubkeyB64 = tauriConf.plugins.updater.pubkey;
const KEY_ID = pubkeyId(pubkeyB64);
const VERSION = '1.0.10';
const EXE = `Nodus_${VERSION}_x64-setup.exe`;
const MSI = `Nodus_${VERSION}_x64_ru-RU.msi`;

function makeSig({ file = EXE, version = VERSION, keyId = KEY_ID, withVersion = true } = {}) {
  const blob = Buffer.alloc(74);
  blob.write('ED', 0, 'ascii');
  Buffer.from(keyId, 'hex').copy(blob, 2);
  randomFillSync(blob, 10, 64);
  const trusted = [
    'trusted comment: timestamp:1792611930',
    `file:${file}`,
    ...(withVersion ? [`version:${version}`] : []),
  ].join('\t');
  const global = Buffer.alloc(64);
  randomFillSync(global, 0, 64);
  return Buffer.from(
    [
      'untrusted comment: signature from tauri secret key',
      blob.toString('base64'),
      trusted,
      global.toString('base64'),
      '',
    ].join('\n'),
    'utf8',
  ).toString('base64');
}

function buildRelease({ withMsi = false } = {}) {
  const nsisSig = makeSig({ file: EXE });
  const platforms = {
    'windows-x86_64-nsis': { signature: nsisSig, url: `/desktop/releases/${VERSION}/${EXE}` },
    'windows-x86_64': { signature: nsisSig, url: `/desktop/releases/${VERSION}/${EXE}` },
  };
  const files = { [EXE]: 4064139 };
  const sigs = { [`${EXE}.sig`]: nsisSig };
  if (withMsi) {
    const msiSig = makeSig({ file: MSI });
    platforms['windows-x86_64-msi'] = {
      signature: msiSig,
      url: `/desktop/releases/${VERSION}/${MSI}`,
    };
    files[MSI] = 6115328;
    sigs[`${MSI}.sig`] = msiSig;
  }
  return {
    manifest: {
      version: VERSION,
      notes: 'проверка выпуска',
      pub_date: '2026-11-02T00:00:00.000Z',
      platforms,
    },
    files,
    sigs,
    pubkeyB64,
  };
}

function setNsisSignature(release, signature) {
  const url = `/desktop/releases/${VERSION}/${EXE}`;
  release.manifest.platforms['windows-x86_64-nsis'] = { signature, url };
  release.manifest.platforms['windows-x86_64'] = { signature, url };
  release.sigs[`${EXE}.sig`] = signature;
}

test('валидный выпуск без MSI проходит без ошибок', () => {
  assert.deepEqual(validateRelease(buildRelease()), []);
});

test('валидный выпуск с подписанным MSI проходит без ошибок', () => {
  assert.deepEqual(validateRelease(buildRelease({ withMsi: true })), []);
});

test('неподписанный MSI рядом с выпуском не мешает', () => {
  const release = buildRelease();
  release.files[MSI] = 6115328;
  assert.deepEqual(validateRelease(release), []);
});

test('подпись без version отвергается (класс инцидента 1.0.7/1.0.8)', () => {
  const release = buildRelease();
  setNsisSignature(release, makeSig({ withVersion: false }));
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes('version:')),
    `ожидалась ошибка про version, получено: ${errors.join(' | ')}`,
  );
});

test('подпись чужим ключом отвергается', () => {
  const release = buildRelease();
  setNsisSignature(release, makeSig({ keyId: '0011223344556677' }));
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes(KEY_ID)),
    `ожидалась ошибка про ключ ${KEY_ID}, получено: ${errors.join(' | ')}`,
  );
});

test('плоский URL вне releases/<версия>/ отвергается', () => {
  const release = buildRelease();
  const url = `/desktop/${EXE}`;
  release.manifest.platforms['windows-x86_64-nsis'].url = url;
  release.manifest.platforms['windows-x86_64'].url = url;
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes('releases/<версия>')),
    `ожидалась ошибка про версионный каталог, получено: ${errors.join(' | ')}`,
  );
});

test('имя файла не своей версии отвергается', () => {
  const release = buildRelease();
  const url = `/desktop/releases/${VERSION}/Nodus_1.0.9_x64-setup.exe`;
  release.manifest.platforms['windows-x86_64-nsis'].url = url;
  release.manifest.platforms['windows-x86_64'].url = url;
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes('не соответствует версии')),
    `ожидалась ошибка про имя файла, получено: ${errors.join(' | ')}`,
  );
});

test('повтор уже выпущенной версии отвергается', () => {
  const errors = validateRelease({ ...buildRelease(), currentVersion: VERSION });
  assert.ok(
    errors.some((error) => error.includes('не больше текущей')),
    `ожидалась ошибка про версию, получено: ${errors.join(' | ')}`,
  );
});

test('понижение версии отвергается', () => {
  const errors = validateRelease({ ...buildRelease(), currentVersion: '1.0.11' });
  assert.ok(
    errors.some((error) => error.includes('не больше текущей')),
    `ожидалась ошибка про версию, получено: ${errors.join(' | ')}`,
  );
});

test('расхождение signature в манифесте и .sig отвергается', () => {
  const release = buildRelease();
  release.manifest.platforms['windows-x86_64-nsis'].signature = makeSig();
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes('не совпадает')),
    `ожидалась ошибка про signature, получено: ${errors.join(' | ')}`,
  );
});

test('выпуск без NSIS-платформы отвергается', () => {
  const release = buildRelease();
  delete release.manifest.platforms['windows-x86_64-nsis'];
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes('windows-x86_64-nsis')),
    `ожидалась ошибка про NSIS, получено: ${errors.join(' | ')}`,
  );
});

test('fallback windows-x86_64 обязан совпадать с NSIS', () => {
  const release = buildRelease();
  release.manifest.platforms['windows-x86_64'].url = `/desktop/releases/${VERSION}/${MSI}`;
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes('не совпадает с windows-x86_64-nsis')),
    `ожидалась ошибка про fallback, получено: ${errors.join(' | ')}`,
  );
});

test('версия не в форме X.Y.Z отвергается', () => {
  const release = buildRelease();
  release.manifest.version = '1.0.10-beta';
  assert.deepEqual(validateRelease(release), ['манифест: version «1.0.10-beta» не в форме X.Y.Z']);
});

test('pubkeyId текущего ключа оболочки', () => {
  assert.equal(KEY_ID, '773fec9b09efa8a5');
});

test('parseSig читает id ключа и поля trusted comment', () => {
  const parsed = parseSig(makeSig());
  assert.equal(parsed.keyId, KEY_ID);
  assert.equal(parsed.fields.file, EXE);
  assert.equal(parsed.fields.version, VERSION);
  assert.ok(parsed.fields.timestamp);
});

test('parseSig отвергает мусор вместо .sig', () => {
  assert.throws(() => parseSig('не base64!'), /не base64/);
});

test('compareSemver сравнивает по старшинству', () => {
  assert.equal(compareSemver('1.0.10', '1.0.9'), 1);
  assert.equal(compareSemver('1.0.9', '1.0.10'), -1);
  assert.equal(compareSemver('1.0.10', '1.0.10'), 0);
  assert.equal(compareSemver('2.0.0', '1.99.99'), 1);
});

test('compareSemver отвергает не semver', () => {
  assert.throws(() => compareSemver('1.0', '1.0.0'), /не semver/);
});
