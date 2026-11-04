use std::fs;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, State, Url};

use crate::bridge;
use crate::state::{Phase, ShellState};

/// Состояние подключения для мини-UI (сериализуется в union-тип TypeScript).
/// Поля — camelCase под контракт apps/desktop/src/shell/shell-ipc.ts.
#[derive(Clone, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ConnectionState {
    Idle {
        /// Сохранённый адрес (авто-повтор подключения экраном «Адрес портала»).
        #[serde(rename = "savedAddress")]
        saved_address: Option<String>,
    },
    Connecting,
    Offline {
        address: String,
    },
    #[serde(rename_all = "camelCase")]
    NeedsUpdate {
        address: String,
        server_name: String,
        #[serde(rename = "minShellVersion")]
        min_shell_version: String,
    },
    #[serde(rename_all = "camelCase")]
    Ready {
        address: String,
        server_name: String,
    },
}

#[derive(Debug)]
struct DesktopConfig {
    server_name: String,
    min_shell_version: String,
}

fn config_file(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("portal.json"))
}

/// Адрес, зашитый в сборку (CI-арг NODUS_PORTAL_URL, модель Битрикса для
/// корпоративной раскатки): приоритетнее сохранённого — сотрудники ничего
/// не вводят; пустой/невалидный зашитый тихо игнорируется.
const BAKED_PORTAL_URL: Option<&str> = option_env!("NODUS_PORTAL_URL");

pub fn load_saved_address(app: &AppHandle) -> Option<String> {
    if let Some(baked) = BAKED_PORTAL_URL {
        if let Ok(root) = normalize_address(baked) {
            return Some(root);
        }
        log::warn!("зашитый NODUS_PORTAL_URL невалиден, игнорируем: {baked}");
    }
    #[derive(serde::Deserialize)]
    struct Saved {
        address: String,
    }
    let file = config_file(app)?;
    let raw = fs::read_to_string(file).ok()?;
    serde_json::from_str::<Saved>(&raw).ok().map(|s| s.address)
}

fn save_address(app: &AppHandle, address: &str) {
    let Some(file) = config_file(app) else { return };
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(&file, serde_json::json!({ "address": address }).to_string());
}

/// Валидация и нормализация адреса портала: схема http/https (без неё —
/// https), обязателен хост, без user-info, без пути/запроса. Итог — origin.
pub fn normalize_address(input: &str) -> Result<String, &'static str> {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.is_empty() || trimmed.contains('@') || trimmed.contains(' ') {
        return Err("invalid_address");
    }
    let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&candidate).map_err(|_| "invalid_address")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("invalid_address");
    }
    let Some(host) = url.host_str() else {
        return Err("invalid_address");
    };
    if host.is_empty() || !host.contains('.') && !host.parse::<std::net::IpAddr>().is_ok() {
        // Либо домен с точкой, либо IP — отсекаем мусор вида «abc».
        if !host.ends_with("localhost") {
            return Err("invalid_address");
        }
    }
    Ok(url.origin().ascii_serialization())
}

/// GET /api/v1/desktop/config (ADR-0019). Ответ любого кода = сервер жив
/// (404 на старом портале → толерантные дефолты); сетевая ошибка = офлайн.
async fn fetch_config(root: &str) -> Result<DesktopConfig, String> {
    // Провайдер rustls один на процесс; ошибка = уже установлен (updater).
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(format!("{root}/api/v1/desktop/config"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Ok(DesktopConfig {
            server_name: "Nodus".into(),
            min_shell_version: "0.0.0".into(),
        });
    }
    #[derive(serde::Deserialize, Default)]
    struct Raw {
        #[serde(default)]
        server_name: Option<String>,
        #[serde(default)]
        min_shell_version: Option<String>,
    }
    let raw: Raw = resp.json().await.unwrap_or_default();
    Ok(DesktopConfig {
        server_name: raw
            .server_name
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Nodus".into()),
        min_shell_version: raw
            .min_shell_version
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "0.0.0".into()),
    })
}

/// Оболочка не ниже minShellVersion? (semver; кривой минимум = 0.0.0 — не блокируем.)
fn version_satisfies(app_version: &str, min_version: &str) -> bool {
    let app = semver::Version::parse(app_version).unwrap_or(semver::Version::new(0, 0, 0));
    let min = semver::Version::parse(min_version).unwrap_or(semver::Version::new(0, 0, 0));
    app >= min
}

/// Ядро подключения: конфиг → проверка версии → capability + навигация.
/// Вызывается командами мини-UI (submit/retry) — без блокировок на await.
async fn connect(app: AppHandle, root: String) -> ConnectionState {
    let version = app.package_info().version.to_string();
    let cfg = match fetch_config(&root).await {
        Ok(cfg) => cfg,
        Err(e) => {
            log::warn!("портал {root} недоступен: {e}");
            set_phase(&app, Phase::Offline, Some(root.clone()), None);
            return ConnectionState::Offline { address: root };
        }
    };
    if !version_satisfies(&version, &cfg.min_shell_version) {
        log::info!(
            "оболочка {version} ниже минимума {} сервера",
            cfg.min_shell_version
        );
        set_phase(&app, Phase::NeedsUpdate, Some(root.clone()), Some(&cfg));
        return ConnectionState::NeedsUpdate {
            address: root,
            server_name: cfg.server_name,
            min_shell_version: cfg.min_shell_version,
        };
    }
    if let Err(e) = bridge::grant_portal_capability(&app, &root) {
        log::error!("не выдана capability моста: {e}");
    }
    if let Some(win) = app.get_webview_window("main") {
        if let Ok(mut url) = Url::parse(&root) {
            // Кэш WebView2 отдавал документ портала без ревалидации между
            // запусками (HTTP-эвристика свежести; фидбек 09.10: оболочка
            // неделями могла жить на старой сборке веба — серверные
            // no-cache правила лечат только НОВЫЕ ответы). Одноразовый
            // параметр адреса делает документ физически не-из-кэша при
            // каждом запуске; хэш-ассенты остаются в кэше законно
            // (именованы содержимым).
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or_default();
            url.query_pairs_mut().append_pair("_nd", &nonce.to_string());
            if let Err(e) = win.navigate(url) {
                log::error!("навигация на портал не удалась: {e}");
            }
        }
    }
    set_phase(&app, Phase::Ready, Some(root.clone()), Some(&cfg));
    log::info!("подключено к «{}» ({root})", cfg.server_name);
    // Фоновая проверка обновлений оболочки (тихо, результат не блокирует вход).
    crate::updates::spawn_startup_check(app.clone());
    ConnectionState::Ready {
        address: root,
        server_name: cfg.server_name,
    }
}

fn set_phase(app: &AppHandle, phase: Phase, root: Option<String>, cfg: Option<&DesktopConfig>) {
    let state = app.state::<ShellState>();
    let mut inner = state.inner.lock().unwrap();
    inner.phase = phase;
    if root.is_some() {
        inner.portal_root = root;
    }
    if let Some(cfg) = cfg {
        inner.server_name = Some(cfg.server_name.clone());
        inner.min_shell_version = Some(cfg.min_shell_version.clone());
    }
}

#[tauri::command]
pub fn get_connection_state(app: AppHandle, state: State<'_, ShellState>) -> ConnectionState {
    let inner = state.inner.lock().unwrap();
    let address = inner.portal_root.clone();
    let server = inner.server_name.clone().unwrap_or_else(|| "Nodus".into());
    match inner.phase {
        Phase::Idle => ConnectionState::Idle {
            saved_address: load_saved_address(&app),
        },
        Phase::Connecting => ConnectionState::Connecting,
        Phase::Offline => ConnectionState::Offline {
            address: address.unwrap_or_default(),
        },
        Phase::NeedsUpdate => ConnectionState::NeedsUpdate {
            address: address.unwrap_or_default(),
            server_name: server,
            min_shell_version: inner
                .min_shell_version
                .clone()
                .unwrap_or_else(|| "0.0.0".into()),
        },
        Phase::Ready => ConnectionState::Ready {
            address: address.unwrap_or_default(),
            server_name: server,
        },
    }
}

#[tauri::command]
pub async fn submit_portal_address(
    app: AppHandle,
    state: State<'_, ShellState>,
    address: String,
) -> Result<ConnectionState, String> {
    let root = normalize_address(&address)?;
    {
        let mut inner = state.inner.lock().unwrap();
        inner.phase = Phase::Connecting;
    }
    save_address(&app, &root);
    Ok(connect(app, root).await)
}

#[tauri::command]
pub async fn retry_connection(
    app: AppHandle,
    state: State<'_, ShellState>,
) -> Result<ConnectionState, String> {
    let root = load_saved_address(&app).ok_or("no_saved_address")?;
    {
        let mut inner = state.inner.lock().unwrap();
        inner.phase = Phase::Connecting;
        inner.portal_root = Some(root.clone());
    }
    Ok(connect(app, root).await)
}

/// «Сменить сервер…» из меню трея: чистый рестарт с пустым адресом —
/// capability старого origin'а умирает вместе с процессом (ADR-0019).
#[tauri::command]
pub fn change_server(app: AppHandle) {
    if let Some(file) = config_file(&app) {
        let _ = fs::remove_file(file);
    }
    app.restart();
}

/// Текущий root портала для остальных модулей (updater, deep links).
pub fn portal_root(app: &AppHandle) -> Option<String> {
    app.state::<ShellState>()
        .inner
        .lock()
        .unwrap()
        .portal_root
        .clone()
}

/// Портал готов и окно навигировано (гейт для доставки deep link'ов).
pub fn is_ready(app: &AppHandle) -> bool {
    app.state::<ShellState>().inner.lock().unwrap().phase == Phase::Ready
}

pub fn take_pending_deep_link(app: &AppHandle) -> Option<String> {
    let state = app.state::<ShellState>();
    let mut inner = state.inner.lock().unwrap();
    inner.pending_deep_link.take()
}

pub fn set_pending_deep_link(app: &AppHandle, url: String) {
    let state = app.state::<ShellState>();
    let mut inner = state.inner.lock().unwrap();
    if inner.pending_deep_link.is_none() {
        inner.pending_deep_link = Some(url);
    }
}
