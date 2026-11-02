// Тесты проверок выпуска (#562). Установщики в git не лежат (infra/desktop-dist
// в .gitignore), поэтому фикстуры строятся здесь же: генерируется настоящая
// пара Ed25519, файл подписывается по формату minisign (prehashed BLAKE2b-512 +
// global-подпись trusted comment). Так проверяется не только структура .sig, но
// и криптографическая сверка — подделка с публичным keyId не проходит.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareSemver,
  parseSig,
  pubkeyId,
  releaseFileNames,
  validateRelease,
  verifySignature,
} from './desktop-release.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tauriConf = JSON.parse(
  readFileSync(resolve(repoRoot, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
);
const realPubkeyB64 = tauriConf.plugins.updater.pubkey;

const VERSION = '1.0.10';
const EXE = `Nodus_${VERSION}_x64-setup.exe`;
const MSI = `Nodus_${VERSION}_x64_ru-RU.msi`;

// Своя пара ключей для фикстур: приватного ключа оболочки у теста нет и быть не должно.
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const KEY_ID = '0011223344556677';
const rawPublicKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
const pubkeyB64 = Buffer.from(
  [
    'untrusted comment: minisign public key: 0011223344556677',
    Buffer.concat([Buffer.from('Ed'), Buffer.from(KEY_ID, 'hex'), rawPublicKey]).toString('base64'),
    '',
  ].join('\n'),
  'utf8',
).toString('base64');

function makeSig(
  fileBytes,
  { file = EXE, version = VERSION, keyId = KEY_ID, withVersion = true } = {},
) {
  const signature = cryptoSign(
    null,
    createHash('blake2b512').update(fileBytes).digest(),
    privateKey,
  );
  const blob = Buffer.concat([Buffer.from('ED'), Buffer.from(keyId, 'hex'), signature]);
  const trusted = [
    'trusted comment: timestamp:1792611930',
    `file:${file}`,
    ...(withVersion ? [`version:${version}`] : []),
  ].join('\t');
  const global = cryptoSign(
    null,
    Buffer.concat([signature, Buffer.from(trusted.slice('trusted comment: '.length))]),
    privateKey,
  );
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
  const exeBytes = Buffer.alloc(4096, 7);
  const nsisSig = makeSig(exeBytes, { file: EXE });
  const platforms = {
    'windows-x86_64-nsis': { signature: nsisSig, url: `/desktop/releases/${VERSION}/${EXE}` },
    'windows-x86_64': { signature: nsisSig, url: `/desktop/releases/${VERSION}/${EXE}` },
  };
  const files = { [EXE]: exeBytes.length };
  const sigs = { [`${EXE}.sig`]: nsisSig };
  const contents = { [EXE]: exeBytes };
  if (withMsi) {
    const msiBytes = Buffer.alloc(8192, 9);
    const msiSig = makeSig(msiBytes, { file: MSI });
    platforms['windows-x86_64-msi'] = {
      signature: msiSig,
      url: `/desktop/releases/${VERSION}/${MSI}`,
    };
    files[MSI] = msiBytes.length;
    sigs[`${MSI}.sig`] = msiSig;
    contents[MSI] = msiBytes;
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
    contents,
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
  release.contents[MSI] = Buffer.alloc(6115328, 1);
  assert.deepEqual(validateRelease(release), []);
});

test('подпись без version отвергается (класс инцидента 1.0.7/1.0.8)', () => {
  const release = buildRelease();
  setNsisSignature(release, makeSig(release.contents[EXE], { withVersion: false }));
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes('version:')),
    `ожидалась ошибка про version, получено: ${errors.join(' | ')}`,
  );
});

test('подпись чужим ключом отвергается', () => {
  const release = buildRelease();
  setNsisSignature(release, makeSig(release.contents[EXE], { keyId: 'ffeeddccbbaa9988' }));
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes(KEY_ID)),
    `ожидалась ошибка про ключ ${KEY_ID}, получено: ${errors.join(' | ')}`,
  );
});

test('подмена байтов установщика отвергается криптографией', () => {
  const release = buildRelease();
  release.contents[EXE] = Buffer.alloc(4096, 8);
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes('не сходится')),
    `ожидалась криптографическая ошибка, получено: ${errors.join(' | ')}`,
  );
});

test('подделка trusted comment отвергается global-подписью', () => {
  const release = buildRelease();
  const text = Buffer.from(release.sigs[`${EXE}.sig`], 'base64').toString('utf8');
  const forged = Buffer.from(text.replace('version:1.0.10', 'version:1.0.11'), 'utf8').toString(
    'base64',
  );
  setNsisSignature(release, forged);
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes('global-подпись')),
    `ожидалась ошибка global-подписи, получено: ${errors.join(' | ')}`,
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

test('вложенный путь в URL отвергается (иначе файл ляжет не туда)', () => {
  const release = buildRelease();
  const url = `/desktop/releases/${VERSION}/sub/${EXE}`;
  release.manifest.platforms['windows-x86_64-nsis'].url = url;
  release.manifest.platforms['windows-x86_64'].url = url;
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes('ровно')),
    `ожидалась ошибка про точный URL, получено: ${errors.join(' | ')}`,
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

test('неизвестная платформа в манифесте отвергается', () => {
  const release = buildRelease();
  release.manifest.platforms['linux-x86_64'] = {
    signature: release.sigs[`${EXE}.sig`],
    url: `/desktop/releases/${VERSION}/${EXE}`,
  };
  const errors = validateRelease(release);
  assert.ok(
    errors.some((error) => error.includes('неизвестная платформа')),
    `ожидалась ошибка про платформу, получено: ${errors.join(' | ')}`,
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
  // Ed25519 детерминирован: другая подпись получается только над другим сообщением.
  release.manifest.platforms['windows-x86_64-nsis'].signature = makeSig(release.contents[EXE], {
    file: EXE,
    version: '1.0.9',
  });
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

test('releaseFileNames берёт только установщики, без fallback-дублей', () => {
  assert.deepEqual(releaseFileNames(buildRelease().manifest), [EXE]);
  assert.deepEqual(releaseFileNames(buildRelease({ withMsi: true }).manifest), [EXE, MSI]);
});

test('verifySignature принимает настоящую подпись и отвергает чужую', () => {
  const bytes = Buffer.alloc(1024, 3);
  const sig = makeSig(bytes);
  assert.equal(verifySignature({ fileBytes: bytes, sigText: sig, pubkeyB64 }), true);
  assert.throws(
    () => verifySignature({ fileBytes: Buffer.alloc(1024, 4), sigText: sig, pubkeyB64 }),
    /не сходится/,
  );
});

test('pubkeyId текущего ключа оболочки', () => {
  assert.equal(pubkeyId(realPubkeyB64), '773fec9b09efa8a5');
});

test('parseSig читает id ключа и поля trusted comment', () => {
  const parsed = parseSig(makeSig(Buffer.alloc(16, 1)));
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
