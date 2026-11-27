//! Скачивания в оболочке (#647): WebView2 молча кладёт файл в «Загрузки» —
//! на завершение загрузки показываем карточку «Файл скачан» с кнопкой
//! «Показать в папке». Карточка живёт в ВЕРХНЕМ слоте у панели (#1038),
//! серия схлопывается в счётчик — состояние серии в `download_slot.rs`;
//! каждое завершение (успех и неуспех) дополнительно уходит в реестр с
//! памятью между запусками — `download_registry.rs`. Абсолютный путь файла
//! мини-UI попапа не получает: команда reveal слота берёт путь из серии;
//! из веба путь приходит только записью реестра (`download_reveal`) — и
//! тогда прогоняется через тот же гвард каталога «Загрузки».

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Url, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

use crate::download_registry;
use crate::download_slot;

/// Сообщить о завершённой загрузке — верхний слот (#1038) и реестр (#1038,
/// раздел 5). Вызывать ТОЛЬКО из async-контекста: билдер окна в синхронном
/// обработчике дедлокит WebView2 (gotcha «Десктоп»).
pub(crate) fn notify_finished(app: &AppHandle, url: &Url, path: Option<PathBuf>, success: bool) {
    let file_name = path
        .as_ref()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().into_owned())
        .or_else(|| url_file_name(url))
        .unwrap_or_else(|| "Файл".into());
    let path_str = path.as_ref().map(|p| p.to_string_lossy().into_owned());
    download_slot::on_finished(app, url.as_str(), &file_name, path_str.clone(), success);
    download_registry::record_finished(app, &file_name, path_str, success);
}

/// Началась загрузка (#1069): пометить in-flight СИНХРОННО (обработчик wry
/// `Requested` синхронный — окно слота там создавать нельзя) и показать
/// карточку «Скачивается» из async-контекста. Имя — из выбранного пути
/// (Content-Disposition/дефолт «Загрузок»), запасной — из URL.
pub(crate) fn notify_started(app: &AppHandle, url: &Url, path: &Path) {
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .or_else(|| url_file_name(url))
        .unwrap_or_else(|| "Файл".into());
    download_slot::mark_started(url.as_str(), &file_name);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        download_slot::show_started(&app);
    });
}

/// Имя файла из URL — запасной вариант, если WebView2 не отдал путь
/// (успешная загрузка на Windows путь отдаёт всегда).
fn url_file_name(url: &Url) -> Option<String> {
    url.path_segments()?
        .next_back()
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
}

/// Кнопка «Показать в папке»: путь берём из серии слота скачивания (#1038) —
/// из JS не приходит ни одного аргумента; это путь ПОСЛЕДНЕГО файла серии.
#[tauri::command]
pub fn popup_reveal_download(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if !download_slot::is_slot(window.label()) {
        return Err("not_download_popup".into());
    }
    let raw = download_slot::last_path().ok_or_else(|| "not_download_popup".to_string())?;
    let downloads = app
        .path()
        .download_dir()
        .map_err(|_| "no_downloads_dir".to_string())?;
    let file = checked_file_in_dir(&downloads, Path::new(&raw))?;
    app.opener()
        .reveal_item_in_dir(&file)
        .map_err(|e| e.to_string())?;
    let _ = window.close();
    Ok(())
}

/// Файл существует и лежит ВНУТРИ каталога загрузок. Канонизация снимает
/// симлинки: файл-симлинк наружу каталога отвергается. Общий гвард обоих
/// reveal: попапа слота (`popup_reveal_download`) и записи реестра
/// (`download_registry::download_reveal`).
pub(crate) fn checked_file_in_dir(dir: &Path, candidate: &Path) -> Result<PathBuf, String> {
    if !candidate.is_absolute() {
        return Err("invalid_path".into());
    }
    let dir = dir
        .canonicalize()
        .map_err(|_| "no_downloads_dir".to_string())?;
    let file = candidate
        .canonicalize()
        .map_err(|_| "invalid_path".to_string())?;
    if !file.starts_with(&dir) || !file.is_file() {
        return Err("invalid_path".into());
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    /// Временный каталог под тест: сносится на Drop, имя уникально процессом.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("nodus-downloads-{tag}-{}", std::process::id()));
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

    #[test]
    fn файл_внутри_загрузок_принимается() {
        let dir = TempDir::new("inside");
        let file = dir.0.join("Смета.xlsx");
        fs::write(&file, b"x").unwrap();
        let checked = checked_file_in_dir(&dir.0, &file).expect("файл внутри загрузок");
        assert_eq!(checked, file.canonicalize().unwrap());
    }

    #[test]
    fn файл_вне_загрузок_отвергается() {
        let downloads = TempDir::new("downloads");
        let elsewhere = TempDir::new("elsewhere");
        let file = elsewhere.0.join("secret.txt");
        fs::write(&file, b"x").unwrap();
        assert_eq!(
            checked_file_in_dir(&downloads.0, &file).unwrap_err(),
            "invalid_path"
        );
    }

    #[test]
    fn несуществующий_файл_отвергается() {
        let downloads = TempDir::new("missing");
        let file = downloads.0.join("нет-такого.pdf");
        assert_eq!(
            checked_file_in_dir(&downloads.0, &file).unwrap_err(),
            "invalid_path"
        );
    }

    #[test]
    fn каталог_вместо_файла_отвергается() {
        let downloads = TempDir::new("dir");
        let subdir = downloads.0.join("папка");
        fs::create_dir_all(&subdir).unwrap();
        assert_eq!(
            checked_file_in_dir(&downloads.0, &subdir).unwrap_err(),
            "invalid_path"
        );
    }

    #[test]
    fn относительный_путь_отвергается() {
        let downloads = TempDir::new("relative");
        assert_eq!(
            checked_file_in_dir(&downloads.0, Path::new("Смета.xlsx")).unwrap_err(),
            "invalid_path"
        );
    }
}
