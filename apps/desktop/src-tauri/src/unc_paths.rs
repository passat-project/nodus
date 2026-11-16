//! Путь к файлу на сервере компании (#558, ADR-0029 Р11): «Открыть» и
//! «Показать в папке» в десктоп-оболочке. Мост принимает строку от
//! веб-контента; Rust повторно проверяет грамматику, канонизирует цель и
//! сверяет её с переданным порталом списком (граница доверия — origin
//! портала, ADR-0019): только UNC `\\server\share` из списка разрешённых
//! папок, без `..`, NUL, управляющих символов, имён устройств и пространства
//! имён `\\?\`; исполняемые файлы и ярлыки не запускаются — для них доступно
//! только «Показать в папке».
//!
//! Список разрешённых папок — настройка администратора «Настройки портала →
//! Файловые серверы»; веб получает его аутентифицированным запросом и
//! передаёт вместе с командой. Оболочка не хранит токены (ADR-0019), поэтому
//! список — аргумент, а не серверное состояние.

use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// Потолок значения-пути — как лимит контракта `CUSTOM_FIELD_LIMITS.link`.
const MAX_PATH_LEN: usize = 2000;

/// Исполняемые файлы, скрипты, установщики и ярлыки: только «Показать в папке».
/// Список — политика оболочки; веб скрывает «Открыть» по тому же набору
/// (контракты `REVEAL_ONLY_EXTENSIONS`), но Rust проверяет независимо.
const REVEAL_ONLY_EXTENSIONS: &[&str] = &[
    "exe",
    "com",
    "bat",
    "cmd",
    "pif",
    "scr",
    "msi",
    "msp",
    "ps1",
    "psm1",
    "vbs",
    "vbe",
    "js",
    "jse",
    "wsf",
    "wsh",
    "hta",
    "cpl",
    "lnk",
    "url",
    "reg",
    "inf",
    "scf",
    "msc",
    "jar",
    "py",
    "pyw",
    "ps1xml",
    "psc1",
    "pssc",
    "sct",
    "shs",
    "application",
    "appref-ms",
    "appx",
    "appxbundle",
    "msix",
    "msixbundle",
    "gadget",
    "dll",
    "ocx",
    "sys",
    "drv",
    "xll",
    "vsto",
    "chm",
    "msh",
    "mshxml",
    "xbap",
    "dotm",
    "docm",
    "xlsm",
    "xltm",
    "pptm",
    "potm",
    "ppsm",
    "sldm",
    "xlsb",
    "xlam",
    "xla",
    "ppam",
    "wll",
    "wbk",
    "accdb",
    "accde",
    "iso",
    "img",
    "vhd",
    "vhdx",
    "diagcab",
    "settingcontent-ms",
    "search-ms",
    "website",
    "library-ms",
];

fn valid_server(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > 253 {
        return false;
    }
    let first = bytes[0] as char;
    let last = bytes[bytes.len() - 1] as char;
    if !first.is_ascii_alphanumeric() || !last.is_ascii_alphanumeric() {
        return false;
    }
    bytes
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || matches!(*b, b'.' | b'-' | b'_'))
}

fn valid_share(value: &str) -> bool {
    if value.is_empty() || value.chars().count() > 80 || value == "." || value == ".." {
        return false;
    }
    if value.ends_with('.') || value.ends_with(' ') {
        return false;
    }
    value.chars().all(|c| {
        !c.is_control() && !matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
    })
}

fn is_device_name(segment: &str) -> bool {
    let base = segment
        .split('.')
        .next()
        .unwrap_or(segment)
        .to_ascii_uppercase();
    matches!(
        base.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

/// Разбор разрешённой папки `\\server\share` (без хвоста пути).
fn parse_file_server(raw: &str) -> Option<(&str, &str)> {
    let value = raw.trim().trim_end_matches('\\');
    let rest = value.strip_prefix("\\\\")?;
    let mut parts = rest.split('\\');
    let server = parts.next()?;
    let share = parts.next()?;
    if parts.next().is_some() || !valid_server(server) || !valid_share(share) {
        return None;
    }
    Some((server, share))
}

fn path_key(server: &str, share: &str) -> String {
    format!("{}\\{}", server.to_lowercase(), share.to_lowercase())
}

/// Ключ `сервер\папка` из UNC-строки (`\\server\share[\…]`).
fn canonical_key(value: &str) -> Option<String> {
    let rest = value.strip_prefix("\\\\")?;
    let mut parts = rest.split('\\');
    let server = parts.next()?;
    let share = parts.next()?;
    if !valid_server(server) || !valid_share(share) {
        return None;
    }
    Some(path_key(server, share))
}

/// Каноническая цель команды: `std::fs::canonicalize` снимает reparse-точки
/// (симлинк/junction) и пространство `\\?\UNC\`; цель обязана остаться в той
/// же разрешённой папке. DFS-реферал на другой сервер отвергается осознанно:
/// граница «только внутри папки» важнее прозрачности DFS.
fn canonical_unc_path(path: &Path, expected_key: &str) -> Result<PathBuf, &'static str> {
    let canonical = std::fs::canonicalize(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => "not_found",
        _ => "path_unavailable",
    })?;
    let raw = canonical.to_string_lossy();
    let normalized = if let Some(rest) = raw.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{rest}")
    } else if raw.starts_with("\\\\?\\") || raw.starts_with("\\\\.\\") {
        return Err("path_not_allowed");
    } else if raw.starts_with("\\\\") {
        raw.into_owned()
    } else {
        return Err("path_not_allowed");
    };
    if canonical_key(&normalized).as_deref() != Some(expected_key) {
        return Err("path_not_allowed");
    }
    Ok(PathBuf::from(normalized))
}

/// Строгая проверка пути: грамматика + принадлежность разрешённой папке.
/// `Err` — стабильный код для веба (файл не найден проверяется отдельно).
fn validate_unc_path(raw: &str, servers: &[String]) -> Result<PathBuf, &'static str> {
    if servers.len() > 50 || servers.iter().any(|server| server.chars().count() > 400) {
        return Err("invalid_path");
    }
    if raw.is_empty() || raw.chars().count() > MAX_PATH_LEN || raw.trim() != raw {
        return Err("invalid_path");
    }
    if raw.chars().any(char::is_control) {
        return Err("invalid_path");
    }
    // Хвостовой разделитель — законная запись папки; открываем без него.
    let value = raw.trim_end_matches('\\');
    if value.len() <= 2 {
        return Err("invalid_path");
    }
    let Some(rest) = value.strip_prefix("\\\\") else {
        return Err("invalid_path");
    };
    // Пространство имён устройства (`\\?\`, `\\.\`) — не пользовательский путь.
    if rest.starts_with("?\\") || rest.starts_with(".\\") {
        return Err("invalid_path");
    }
    let segments: Vec<&str> = rest.split('\\').collect();
    if segments.len() < 2 {
        return Err("invalid_path");
    }
    for segment in &segments {
        if segment.is_empty()
            || *segment == "."
            || *segment == ".."
            || segment.ends_with('.')
            || segment.ends_with(' ')
            || is_device_name(segment)
            || segment.chars().any(|c| {
                c.is_control() || matches!(c, '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
            })
        {
            return Err("invalid_path");
        }
    }
    let server = segments[0];
    let share = segments[1];
    if !valid_server(server) || !valid_share(share) {
        return Err("invalid_path");
    }
    let key = path_key(server, share);
    let allowed = servers
        .iter()
        .filter_map(|value| parse_file_server(value))
        .any(|(allowed_server, allowed_share)| path_key(allowed_server, allowed_share) == key);
    if !allowed {
        return Err("server_not_allowed");
    }
    Ok(PathBuf::from(value))
}

/// Файл такого типа нельзя запускать — только показать в папке.
fn is_reveal_only(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some((_, extension)) = name.rsplit_once('.') else {
        return false;
    };
    REVEAL_ONLY_EXTENSIONS
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(extension))
}

async fn run_command(
    app: AppHandle,
    raw: String,
    servers: Vec<String>,
    open: bool,
) -> Result<(), String> {
    // Сеть/проводник — блокирующие вызовы: не держим async-поток Tauri.
    tauri::async_runtime::spawn_blocking(move || {
        let path = validate_unc_path(&raw, &servers).map_err(|code| code.to_string())?;
        let key =
            canonical_key(path.to_string_lossy().as_ref()).ok_or("invalid_path".to_string())?;
        let path = canonical_unc_path(&path, &key).map_err(|code| code.to_string())?;
        match std::fs::metadata(&path) {
            Ok(meta) => {
                if open && meta.is_file() && is_reveal_only(&path) {
                    return Err("reveal_only".into());
                }
                if open {
                    app.opener()
                        .open_path(path.to_string_lossy().into_owned(), None::<&str>)
                        .map_err(|_| "open_failed".to_string())
                } else {
                    app.opener()
                        .reveal_item_in_dir(&path)
                        .map_err(|_| "reveal_failed".to_string())
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err("not_found".into()),
            Err(_) => Err("path_unavailable".into()),
        }
    })
    .await
    .map_err(|_| "internal_error".to_string())?
}

/// Открыть файл с разрешённого файлового сервера системным приложением.
#[tauri::command]
pub async fn open_unc_path(
    app: AppHandle,
    path: String,
    servers: Vec<String>,
) -> Result<(), String> {
    run_command(app, path, servers, true).await
}

/// Показать файл в проводнике с выделением (папку — открыть её саму).
#[tauri::command]
pub async fn reveal_unc_path(
    app: AppHandle,
    path: String,
    servers: Vec<String>,
) -> Result<(), String> {
    run_command(app, path, servers, false).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn servers() -> Vec<String> {
        vec!["\\\\FS01\\Projects".into()]
    }

    #[test]
    fn accepts_file_inside_allowed_share() {
        let path = "\\\\FS01\\Projects\\Дом 12\\план.pdf";
        expect_ok(path);
        // Регистр сервера и папки не важен (Windows).
        expect_ok("\\\\fs01\\projects\\план.pdf");
        // Хвостовой разделитель — законная запись папки.
        expect_ok("\\\\FS01\\Projects\\Дом 12\\");
    }

    fn expect_ok(path: &str) {
        let result = validate_unc_path(path, &servers());
        assert!(result.is_ok(), "{path}: {result:?}");
    }

    #[test]
    fn rejects_foreign_share() {
        // Грамматика верна, но пара «сервер\папка» не разрешена администратором.
        for path in ["\\\\FS02\\Projects\\план.pdf", "\\\\FS01\\Secret\\план.pdf"] {
            assert_eq!(
                validate_unc_path(path, &servers()),
                Err("server_not_allowed"),
                "{path}"
            );
        }
    }

    #[test]
    fn rejects_bad_grammar() {
        for path in [
            "https://example.com/план.pdf",
            "\\\\FS01\\Projects\\..\\Secret\\план.pdf",
            "\\\\FS01\\Projects\\.\\.hidden.pdf",
            "\\\\FS01\\Projects\\план\u{0}.pdf",
            "\\\\FS01\\Projects\\CON.txt",
            "\\\\FS01\\Projects\\COM1\\план.pdf",
            "\\\\FS01\\Projects\\план.pdf ",
            "\\\\FS01\\Projects\\план.pdf.",
            "\\\\?\\UNC\\FS01\\Projects\\план.pdf",
            "\\\\.\\FS01\\Projects\\план.pdf",
            "//FS01/Projects/план.pdf",
        ] {
            assert_eq!(
                validate_unc_path(path, &servers()),
                Err("invalid_path"),
                "{path}"
            );
        }
    }

    #[test]
    fn empty_allowlist_opens_nothing() {
        assert_eq!(
            validate_unc_path("\\\\FS01\\Projects\\план.pdf", &[]),
            Err("server_not_allowed")
        );
        assert_eq!(
            validate_unc_path("\\\\FS01\\Projects\\план.pdf", &["\\\\FS01".into()]),
            Err("server_not_allowed")
        );
    }

    #[test]
    fn allowlist_is_bounded() {
        let too_many = vec!["\\\\FS01\\Projects".to_string(); 51];
        assert_eq!(
            validate_unc_path("\\\\FS01\\Projects\\план.pdf", &too_many),
            Err("invalid_path")
        );
    }

    #[test]
    fn canonical_key_is_unc_only() {
        assert_eq!(
            canonical_key("\\\\FS01\\Projects\\Дом 12\\план.pdf").as_deref(),
            Some("fs01\\projects")
        );
        assert_eq!(canonical_key("\\\\?\\UNC\\FS01\\Projects\\план.pdf"), None);
        assert_eq!(canonical_key("C:\\Projects\\план.pdf"), None);
    }

    #[test]
    fn share_length_is_counted_in_chars() {
        // 45 символов / 85 байт: контракт считает длину, не байты.
        assert!(valid_share("Общая папка отдела проектирования и изысканий"));
    }

    #[test]
    fn reveal_only_covers_executables_and_shortcuts() {
        for name in [
            "setup.exe",
            "run.BAT",
            "script.ps1",
            "link.lnk",
            "site.url",
            "installer.msi",
            "shortcut.scr",
            "macro.vbs",
            "help.chm",
            "book.xlsm",
            "letter.docm",
            "script.py",
        ] {
            assert!(is_reveal_only(Path::new(name)), "{name}");
        }
        for name in [
            "план.pdf",
            "смета.xlsx",
            "письмо.docx",
            "архив.zip",
            "без-точки",
        ] {
            assert!(!is_reveal_only(Path::new(name)), "{name}");
        }
    }
}
