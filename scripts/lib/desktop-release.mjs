// Чистые проверки выпуска оболочки (#562): на входе только данные — без fs,
// сети и процессов, чтобы правила проверялись юнит-тестами без windows-сборки.
// Используется scripts/desktop-publish.mjs при выкладке и самопроверке CI.
//
// Криптографию подписи здесь НЕ проверяем: целостность установщика проверяет
// сам tauri-plugin-updater при установке. Наша задача — не выпустить наружу
// подпись, которую оболочка отвергнет: чужой ключ, подпись без version:,
// URL вне версионного каталога, повтор или понижение версии.

const SEMVER = /^\d+\.\d+\.\d+$/;
const TRUSTED_PREFIX = 'trusted comment: ';
const SIGNATURE_BLOB_BYTES = 74;

/** id ключа minisign (hex) из base64-публичного ключа Tauri. */
export function pubkeyId(pubkeyB64) {
  const lines = decodeText(pubkeyB64, 'публичный ключ').split('\n');
  const blob = decodeBase64((lines[1] ?? '').trim(), 'публичный ключ');
  if (blob.length < 10) throw new Error('публичный ключ: блоб короче 10 байт');
  return blob.subarray(2, 10).toString('hex');
}

/** Разбор .sig Tauri: id ключа подписи и поля trusted comment. */
export function parseSig(sigFileText) {
  const lines = decodeText(sigFileText, '.sig').split('\n');
  const blob = decodeBase64((lines[1] ?? '').trim(), '.sig');
  if (blob.length !== SIGNATURE_BLOB_BYTES) {
    throw new Error(`.sig: блоб подписи ${blob.length} байт вместо ${SIGNATURE_BLOB_BYTES}`);
  }
  const trusted = lines.find((line) => line.startsWith(TRUSTED_PREFIX));
  if (!trusted) throw new Error('.sig: нет trusted comment');
  const fields = {};
  for (const part of trusted.slice(TRUSTED_PREFIX.length).split('\t')) {
    const at = part.indexOf(':');
    if (at > 0) fields[part.slice(0, at)] = part.slice(at + 1);
  }
  return { keyId: blob.subarray(2, 10).toString('hex'), fields };
}

/** Сравнение версий X.Y.Z: -1 / 0 / 1. Не semver — исключение. */
export function compareSemver(a, b) {
  const pa = semverParts(a);
  const pb = semverParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Все нарушения правил выпуска (#562, Р6). Пустой массив — выпуск годен.
 * files — имя → размер в байтах; sigs — имя `.sig` → его текст.
 */
export function validateRelease({ manifest, files, sigs, pubkeyB64, currentVersion }) {
  const version = manifest?.version;
  if (!version || !SEMVER.test(String(version))) {
    return [`манифест: version «${version ?? ''}» не в форме X.Y.Z`];
  }

  const errors = [];
  let keyId = null;
  try {
    keyId = pubkeyId(pubkeyB64);
  } catch (error) {
    errors.push(`публичный ключ: ${error.message}`);
  }

  const platforms = manifest.platforms ?? {};
  const nsis = platforms['windows-x86_64-nsis'];
  const msi = platforms['windows-x86_64-msi'];
  if (!nsis)
    errors.push('манифест: нет платформы windows-x86_64-nsis — установка и обновление сломаются');
  if (nsis) {
    const fallback = platforms['windows-x86_64'];
    if (!fallback) errors.push('манифест: нет fallback-платформы windows-x86_64');
    else if (fallback.url !== nsis.url || fallback.signature !== nsis.signature) {
      errors.push('манифест: windows-x86_64 не совпадает с windows-x86_64-nsis');
    }
  }

  const prefix = `/desktop/releases/${version}/`;
  const entries = [];
  if (nsis) {
    entries.push([
      'windows-x86_64-nsis',
      nsis,
      new RegExp(`^Nodus_${escapeRe(version)}_x64-setup\\.exe$`),
    ]);
  }
  if (msi) {
    entries.push([
      'windows-x86_64-msi',
      msi,
      new RegExp(`^Nodus_${escapeRe(version)}_x64.*\\.msi$`),
    ]);
  }

  for (const [platform, entry, nameRe] of entries) {
    const url = String(entry?.url ?? '');
    if (!url.startsWith(prefix)) {
      errors.push(
        `${platform}: url «${url}» не начинается с «${prefix}» — версии обязаны лежать в releases/<версия>/`,
      );
    }
    const base = url.split('/').pop() ?? '';
    if (!nameRe.test(base)) {
      errors.push(`${platform}: имя файла «${base}» не соответствует версии ${version}`);
    }
    if (!files?.[base]) errors.push(`${platform}: файла «${base}» нет в выпуске или он пуст`);

    const sigText = sigs?.[`${base}.sig`];
    if (!sigText) {
      errors.push(`${platform}: нет подписи «${base}.sig»`);
      continue;
    }
    if (String(entry?.signature ?? '').trim() !== String(sigText).trim()) {
      errors.push(`${platform}: signature в манифесте не совпадает с ${base}.sig`);
    }

    let parsed;
    try {
      parsed = parseSig(sigText);
    } catch (error) {
      errors.push(`${platform}: ${error.message}`);
      continue;
    }
    if (keyId && parsed.keyId !== keyId) {
      errors.push(
        `${platform}: подпись сделана ключом ${parsed.keyId}, а в оболочку зашит ${keyId}`,
      );
    }
    if (parsed.fields.file !== base) {
      errors.push(
        `${platform}: в trusted comment file:${parsed.fields.file ?? '—'}, ожидалось ${base}`,
      );
    }
    if (parsed.fields.version !== version) {
      errors.push(
        `${platform}: в trusted comment version:${parsed.fields.version ?? '—'}, ожидалось ${version} (класс инцидента 1.0.7/1.0.8)`,
      );
    }
  }

  if (currentVersion !== undefined && currentVersion !== null && currentVersion !== '') {
    try {
      if (compareSemver(version, currentVersion) <= 0) {
        errors.push(
          `версия ${version} не больше текущей ${currentVersion} — выпуск не двигает обновление`,
        );
      }
    } catch (error) {
      errors.push(`текущая версия: ${error.message}`);
    }
  }

  return errors;
}

function semverParts(value) {
  const text = String(value ?? '');
  if (!SEMVER.test(text)) throw new Error(`не semver: «${text}»`);
  return text.split('.').map(Number);
}

function decodeText(base64, what) {
  const text = decodeBase64(String(base64 ?? '').trim(), what).toString('utf8');
  if (!text) throw new Error(`${what}: пустое содержимое`);
  return text;
}

function decodeBase64(text, what) {
  if (!text || !/^[A-Za-z0-9+/=\s]+$/.test(text)) throw new Error(`${what}: не base64`);
  return Buffer.from(text, 'base64');
}

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
