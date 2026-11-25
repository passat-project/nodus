//! Реестр загрузок с памятью между запусками (эпик #1038, раздел 5):
//! каждое завершение загрузки — успех И неуспех — становится записью
//! `DownloadEntry` и уходит в `downloads.json` (app_config_dir, рядом с
//! `portal.json`; атомарная запись tmp+rename). Помним последние 100 —
//! новые вытесняют старейшие; битый файл = пустой реестр (лог, не паника).
//!
//! Панель «Загрузки» (мини-UI и панель портала) читает список командой
//! `downloads_list`, живое обновление — событие порталу `download-finished`
//! с полной записью. Запись несёт абсолютный `path` — это доверенные данные
//! оболочки по образцу UNC-команд (#558): «Показать в папке» (`download_reveal`)
//! всё равно прогоняет путь через гвард каталога «Загрузки» в Rust.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::MutexGuard;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::bridge;
use crate::downloads;

/// Сколько записей помним — зеркало contracts `DOWNLOADS_REGISTRY_LIMIT`.
pub(crate) const REGISTRY_LIMIT: usize = 100;

/// Лимит имени файла — зеркало contracts `downloadEntrySchema.fileName`.
const FILE_NAME_MAX_CHARS: usize = 255;

/// Запись реестра загрузок — зеркало contracts `downloadEntrySchema`
/// (рассинхрон = баг): одна завершённая загрузка, путь пуст, если WebView2
/// его не отдал (неуспех).
#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEntry {
    /// Ключ записи (uuid v4): уникален между запусками.
    pub id: String,
    /// Имя файла (≤ 255 символов — обрезается при создании).
    pub file_name: String,
    /// Абсолютный путь файла; пустая строка — путь неизвестен (неуспех).
    pub path: String,
    /// Успех загрузки: false — строка «Не удалось скачать» без кнопки.
    pub success: bool,
    /// Момент завершения (unix epoch, мс) — переживает перезапуск,
    /// поэтому не монотонное время серии слота.
    pub finished_at_ms: u64,
}

/// Живой реестр. Мьютекс-статика (как слот): завершения приходят из
/// async-контекста загрузчика, список читают команды мини-UI и портала.
/// Внутри — от старейшей к новейшей (файл хранит тот же порядок),
/// `downloads_list` отдаёт перевёрнутым.
static REGISTRY: Mutex<Vec<DownloadEntry>> = Mutex::new(Vec::new());

fn registry() -> MutexGuard<'static, Vec<DownloadEntry>> {
    REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Файл реестра — `downloads.json` в app_config_dir (паттерн portal.json).
fn registry_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("downloads.json"))
}

/// Загрузить реестр на старте (lib.rs setup): битый/недоступный файл —
/// пустой реестр и запись в лог, паниковать нельзя.
pub(crate) fn load_registry(app: &AppHandle) {
    let Some(file) = registry_file(app) else {
        log::warn!("downloads: каталог конфигурации недоступен — реестр пуст");
        return;
    };
    let entries = load_from(&file);
    log::info!("downloads: реестр загружен ({} записей)", entries.len());
    *registry() = entries;
}

/// Чистая запись из завершения загрузки: свежий uuid, имя обрезается до
/// лимита контракта. Символами, не байтами — не рвать кириллицу посередине.
fn new_entry(
    file_name: &str,
    path: Option<String>,
    success: bool,
    finished_at_ms: u64,
) -> DownloadEntry {
    DownloadEntry {
        id: uuid::Uuid::new_v4().to_string(),
        file_name: file_name.chars().take(FILE_NAME_MAX_CHARS).collect(),
        path: path.unwrap_or_default(),
        success,
        finished_at_ms,
    }
}

/// Держать не больше лимита: старейшие (начало вектора) вытесняются.
fn cap_to_limit(entries: &mut Vec<DownloadEntry>) {
    let overflow = entries.len().saturating_sub(REGISTRY_LIMIT);
    entries.drain(..overflow);
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Зафиксировать завершение: append + persist + событие порталу. Fail-safe —
/// ошибка записи не роняет уведомление о загрузке.
pub(crate) fn record_finished(
    app: &AppHandle,
    file_name: &str,
    path: Option<String>,
    success: bool,
) {
    let entry = new_entry(file_name, path, success, unix_ms());
    let snapshot = {
        let mut entries = registry();
        entries.push(entry.clone());
        cap_to_limit(&mut entries);
        entries.clone()
    };
    if let Some(file) = registry_file(app) {
        persist(&file, &snapshot);
    }
    // Живое событие панели «Загрузки» (эпик #1038): слушатель вешает веб,
    // пока портала нет — eval в мини-UI тихо уходит без слушателей.
    bridge::push_to_portal(app, "download-finished", &entry);
}

/// Атомарная запись (tmp + rename, паттерн portal.json): читатель не видит
/// половину файла; rename на Windows заменяет существующий файл.
fn persist(file: &Path, entries: &[DownloadEntry]) {
    let Some(dir) = file.parent() else { return };
    if let Err(e) = fs::create_dir_all(dir) {
        log::warn!("downloads: каталог реестра не создан ({e})");
        return;
    }
    let mut tmp_os = file.as_os_str().to_os_string();
    tmp_os.push(".tmp");
    let tmp = PathBuf::from(tmp_os);
    let Ok(json) = serde_json::to_string(entries) else {
        return;
    };
    if let Err(e) = fs::write(&tmp, json) {
        log::warn!("downloads: временный файл реестра не записан ({e})");
        return;
    }
    if let Err(e) = fs::rename(&tmp, file) {
        log::warn!("downloads: реестр не записан ({e})");
        let _ = fs::remove_file(&tmp);
    }
}

/// Прочитать реестр: нет файла — пусто (первый запуск); битый JSON — пусто +
/// лог. Раздутый вручную файл обрезается до лимита (новейшие — хвост).
fn load_from(file: &Path) -> Vec<DownloadEntry> {
    let raw = match fs::read_to_string(file) {
        Ok(raw) => raw,
        Err(e) if e.kind() == ErrorKind::NotFound => return Vec::new(),
        Err(e) => {
            log::warn!("downloads: реестр не прочитан ({e}) — начинаем пустым");
            return Vec::new();
        }
    };
    match serde_json::from_str::<Vec<DownloadEntry>>(&raw) {
        Ok(mut entries) => {
            cap_to_limit(&mut entries);
            entries
        }
        Err(e) => {
            log::warn!("downloads: реестр битый ({e}) — начинаем пустым");
            Vec::new()
        }
    }
}

/// Список реестра (команда моста, эпик #1038): НОВЫЕ ПЕРВЫМИ — панель
/// «Загрузки» показывает свежую загрузку сверху.
#[tauri::command]
pub fn downloads_list() -> Vec<DownloadEntry> {
    let mut entries = registry().clone();
    entries.reverse();
    entries
}

/// «Показать в папке» из реестра (панель «Загрузки»): путь приходит из веба —
/// гвард ОБЯЗАТЕЛЕН, тот же, что у попапа слота (downloads.rs): каталог
/// «Загрузки», канонизация симлинков, только файл.
#[tauri::command]
pub fn download_reveal(app: AppHandle, path: String) -> Result<(), String> {
    let downloads_dir = app
        .path()
        .download_dir()
        .map_err(|_| "no_downloads_dir".to_string())?;
    let file = downloads::checked_file_in_dir(&downloads_dir, Path::new(&path))?;
    app.opener()
        .reveal_item_in_dir(&file)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    /// Временный каталог под тест: сносится на Drop, имя уникально процессом.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "nodus-download-registry-{tag}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("временный каталог создан");
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn entry(n: u64) -> DownloadEntry {
        new_entry(
            &format!("file-{n}.pdf"),
            Some(format!(r"C:\D\file-{n}.pdf")),
            true,
            n,
        )
    }

    /// Лимит 100: новые вытесняют старейшие — в реестре хвост серии,
    /// порядок «от старейшей к новейшей» сохраняется.
    #[test]
    fn добавление_вытесняет_старейшие_сверху_100() {
        let mut entries = Vec::new();
        for n in 0..105 {
            entries.push(entry(n));
            cap_to_limit(&mut entries);
        }
        assert_eq!(entries.len(), REGISTRY_LIMIT);
        assert_eq!(entries.first().unwrap().finished_at_ms, 5, "старейшая — №5");
        assert_eq!(entries.last().unwrap().finished_at_ms, 104);
    }

    /// Persist → load без потерь: формат файла переживает перезапуск.
    #[test]
    fn persist_load_round_trip() {
        let dir = TempDir::new("round-trip");
        let file = dir.0.join("downloads.json");
        let entries: Vec<DownloadEntry> = (0..3).map(entry).collect();
        persist(&file, &entries);
        assert_eq!(load_from(&file), entries);
        // Временного файла не осталось — только итоговый downloads.json.
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    /// Перезапись поверх существующего файла (rename заменяет, не падает).
    #[test]
    fn persist_перезаписывает_существующий_файл() {
        let dir = TempDir::new("rewrite");
        let file = dir.0.join("downloads.json");
        persist(&file, &[entry(1)]);
        let second = vec![entry(2), entry(3)];
        persist(&file, &second);
        assert_eq!(load_from(&file), second);
    }

    /// Битый JSON = пустой реестр (лог, не паника) — эпик #1038, раздел 5.
    #[test]
    fn битый_json_даёт_пустой_реестр() {
        let dir = TempDir::new("broken");
        let file = dir.0.join("downloads.json");
        fs::write(&file, "{не json").unwrap();
        assert!(load_from(&file).is_empty());
    }

    /// Нет файла = первый запуск, пусто и без ошибок.
    #[test]
    fn отсутствующий_файл_даёт_пустой_реестр() {
        let dir = TempDir::new("missing");
        assert!(load_from(&dir.0.join("downloads.json")).is_empty());
    }

    /// Раздутый вручную файл обрезается до лимита — остаются новейшие.
    #[test]
    fn load_обрезает_раздутый_файл() {
        let dir = TempDir::new("oversized");
        let file = dir.0.join("downloads.json");
        let inflated: Vec<DownloadEntry> = (0..120).map(entry).collect();
        fs::write(&file, serde_json::to_string(&inflated).unwrap()).unwrap();
        let loaded = load_from(&file);
        assert_eq!(loaded.len(), REGISTRY_LIMIT);
        assert_eq!(loaded.first().unwrap().finished_at_ms, 20);
        assert_eq!(loaded.last().unwrap().finished_at_ms, 119);
    }

    /// Запись: id — uuid (форма 8-4-4-4-12 hex), имя режется символами,
    /// неуспех без пути хранит пустую строку.
    #[test]
    fn запись_форма_id_имя_и_путь_неудачи() {
        let e = new_entry(&"д".repeat(300), Some(r"C:\D\a.pdf".into()), true, 42);
        assert!(bridge::is_valid_conversation(&e.id), "id — uuid");
        assert_eq!(e.file_name.chars().count(), FILE_NAME_MAX_CHARS);
        assert_eq!(e.path, r"C:\D\a.pdf");

        let failed = new_entry("a.pdf", None, false, 43);
        assert_eq!(failed.path, "");
        assert!(!failed.success);
    }
}
