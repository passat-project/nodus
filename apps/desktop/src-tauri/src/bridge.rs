use serde::Deserialize;
use serde::Serialize;
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, UserAttentionType};
use tauri_plugin_opener::OpenerExt;

use crate::badge;
use crate::popups;
use crate::portal;

/// JS-мост, инъектируемый в webview до скриптов каждой страницы (включая
/// удалённый портал). Прямое направление «веб → оболочка» — команды через
/// штатный IPC (`__TAURI_INTERNALS__.invoke`), разграниченные runtime-
/// capability ровно по origin'у портала; обратное — `__nodusDesktopInvoke`
/// из Rust (`eval`). Токены и креды мост не переносит (ADR-0019).
pub fn initialization_script(shell_version: &str) -> String {
    format!(
        r#"(function () {{
  if (window.__nodusDesktopBridge) return;
  var VERSION = {version};
  var listeners = {{}};
  function invoke(cmd, args) {{
    var i = window.__TAURI_INTERNALS__;
    if (!i || typeof i.invoke !== 'function') {{
      return Promise.reject(new Error('shell-ipc-unavailable'));
    }}
    return i.invoke(cmd, args);
  }}
  window.__nodusDesktopInvoke = function (type, payload) {{
    var fns = listeners[type] || [];
    for (var k = 0; k < fns.length; k++) {{
      try {{ fns[k](payload); }} catch (e) {{ console.error('[nodus-desktop]', e); }}
    }}
    return fns.length > 0;
  }};
  window.nodusDesktop = {{
    shellVersion: VERSION,
    platform: 'windows',
    showPopup: function (p) {{ return invoke('notify_popup', {{ payload: p }}); }},
    setUnreadBadge: function (count) {{ return invoke('set_unread_badge', {{ count: count }}); }},
    flashTaskbar: function (critical) {{ return invoke('flash_taskbar', {{ critical: !!critical }}); }},
    openExternal: function (url) {{ return invoke('open_external', {{ url: url }}); }},
    dismissPopups: function (conversationId) {{ return invoke('dismiss_popups', {{ conversationId: conversationId }}); }},
    setUiTheme: function (theme) {{ return invoke('set_ui_theme', {{ theme: theme }}); }},
    getShellInfo: function () {{ return invoke('get_shell_info'); }},
    getUpdateState: function () {{ return invoke('get_update_state'); }},
    applyUpdate: function () {{ return invoke('apply_update'); }},
    shellReady: function () {{ return invoke('shell_ready'); }},
    onEvent: function (type, fn) {{
      (listeners[type] = listeners[type] || []).push(fn);
      return function () {{
        var arr = listeners[type] || [];
        var i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      }};
    }}
  }};
  Object.defineProperty(window, '__nodusDesktopBridge', {{ value: true }});
}})();"#,
        version = serde_json::to_string(shell_version).unwrap_or_else(|_| "\"0.0.0\"".into())
    )
}

/// Выдать origin'у портала минимальный набор прав моста (dynamic-acl).
/// Паттерн `{origin}/*` покрывает все пути портала; окно — только main.
pub fn grant_portal_capability(app: &AppHandle, root: &str) -> tauri::Result<()> {
    let capability = CapabilityBuilder::new("portal-bridge")
        .local(false)
        .window("main")
        .remote(format!("{root}/*"))
        .permission("allow-notify-popup")
        .permission("allow-set-unread-badge")
        .permission("allow-flash-taskbar")
        .permission("allow-open-external")
        .permission("allow-dismiss-popups")
        .permission("allow-set-ui-theme")
        .permission("allow-get-shell-info")
        .permission("allow-get-update-state")
        .permission("allow-apply-update")
        .permission("allow-shell-ready");
    app.add_capability(capability)
}

/// Пуш события «оболочка → веб» (eval в главное окно). JSON-строки — валидные
/// JS-литералы, экранирование бесплатно.
pub fn push_to_portal(app: &AppHandle, event_type: &str, payload: &impl Serialize) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let js = format!(
        "window.__nodusDesktopInvoke && window.__nodusDesktopInvoke({}, {})",
        serde_json::to_string(event_type).unwrap_or_default(),
        serde_json::to_string(payload).unwrap_or_else(|_| "null".into()),
    );
    if let Err(e) = win.eval(js.as_str()) {
        log::warn!("доставка события {event_type} не удалась: {e}");
    }
}

/// Строгая проверка UUID без зависимости: 8-4-4-4-12 hex (зеркалит
/// z.string().uuid() контракта — Rust-сторона валидирует границу сама).
pub fn is_valid_conversation(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 36
        && b.iter().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => *c == b'-',
            _ => c.is_ascii_hexdigit(),
        })
}

/// Скачивание файла (#647): карточка «Файл скачан» с кнопкой «Показать в
/// папке». Зеркало contracts `popupDownloadSchema` — но абсолютный путь
/// живёт ТОЛЬКО в Rust: в JSON мини-UI он не уходит (payload_to_json
/// перечисляет поля явно), кнопка путь из JS не принимает.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupDownload {
    /// Имя файла для карточки (длинное переносится в две строки).
    pub file_name: String,
    /// Успех скачивания: false — карточка ошибки без кнопки.
    pub success: bool,
    /// Абсолютный путь скачанного файла (для reveal). В JSON не сериализуется.
    #[serde(default)]
    pub path: Option<String>,
}

/// Зеркало contracts `popupPayloadSchema` (desktop-bridge.schema.ts).
/// Цель попапа — ровно одна: беседа, письмо (#618) или скачанный файл (#647).
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupPayload {
    pub id: String,
    pub conversation_id: Option<String>,
    /// Письмо («Поступило письмо», #618): клик открывает карточку письма.
    pub letter_id: Option<String>,
    /// Корень трэда (попап об ответе в трэде): клик раскрывает окно трэда (#300).
    pub thread_root_id: Option<String>,
    pub title: String,
    pub avatar_url: Option<String>,
    pub preview: String,
    /// Превью — метка вложения («Фотография»): попап красит акцентом.
    pub preview_attachment: Option<bool>,
    pub urgent: bool,
    pub can_reply: bool,
    /// Файл скачан (#647): создаёт ТОЛЬКО оболочка (не портал).
    pub download: Option<PopupDownload>,
}

impl PopupPayload {
    /// Ключ гашения попапов источника: портал зовёт dismiss по открытии
    /// беседы/письма (модель Telegram unlinkHistory) — одна строка на цель.
    pub fn dismiss_key(&self) -> &str {
        self.conversation_id
            .as_deref()
            .or(self.letter_id.as_deref())
            .unwrap_or("")
    }
}

/// Зеркало contracts `popupReplyEventSchema`.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupReply {
    pub id: String,
    pub conversation_id: String,
    pub text: String,
}

/// Async обязателен: на Windows создание WebviewWindow из синхронной
/// команды/обработчика ДЕДЛОКИТ WebView2 — окно висит на about:blank
/// (known issue, docs.rs WebviewWindowBuilder; баги tauri #13963/#13092).
#[tauri::command]
pub async fn notify_popup(app: AppHandle, payload: PopupPayload) -> Result<(), String> {
    // Граница контракта на Rust-стороне (security-аудит #254, подозрение 5).
    // Цель — ровно одна (#618): беседа ИЛИ письмо, обе/ни одной — отказ.
    // Скачивание (#647) портал не создаёт вовсе: такую карточку показывает
    // только оболочка по своему событию загрузки — путь файла приходит не из
    // веб-контента.
    let target_ok = match (
        payload.conversation_id.as_deref(),
        payload.letter_id.as_deref(),
    ) {
        (Some(c), None) => is_valid_conversation(c),
        (None, Some(l)) => is_valid_conversation(l),
        _ => false,
    };
    if payload.id.is_empty()
        || payload.id.len() > 200
        || !target_ok
        || payload.download.is_some()
        || payload
            .thread_root_id
            .as_deref()
            .is_some_and(|t| !is_valid_conversation(t))
        || payload.title.is_empty()
        || payload.title.chars().count() > 200
        || payload.preview.chars().count() > 500
        || payload
            .avatar_url
            .as_deref()
            .is_some_and(|u| u.len() > 2000)
    {
        return Err("invalid_payload".into());
    }
    popups::show(&app, payload);
    Ok(())
}

#[tauri::command]
pub fn set_unread_badge(app: AppHandle, count: Option<u32>) {
    badge::apply(&app, count);
}

/// Тема UI портала ('light'|'dark') для попапов: мини-UI попапа не знает о
/// выборе пользователя в портале — портал сообщает при старте и смене, Rust
/// хранит и применяет к живущим окнам и каждому новому попапу.
static UI_THEME: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Тема портала для попапов: 'dark' | 'light' (None до первого set_ui_theme —
/// дефолт светлый). Единственный источник для payload попапа (#305): тема
/// приезжает с данными pull-моделью, гонки inline-скрипта и eval исчезают.
pub fn ui_theme() -> &'static str {
    match UI_THEME.lock().unwrap().as_deref() {
        Some("dark") => "dark",
        _ => "light",
    }
}

fn theme_js() -> &'static str {
    match UI_THEME.lock().unwrap().as_deref() {
        Some("dark") => "document.documentElement.dataset.theme='dark'",
        _ => "delete document.documentElement.dataset.theme",
    }
}

/// Применить сохранённую тему портала к окну (новые попапы — после build).
pub fn apply_ui_theme(win: &tauri::WebviewWindow) {
    let _ = win.eval(theme_js());
}

#[tauri::command]
pub fn set_ui_theme(app: AppHandle, theme: String) -> Result<(), String> {
    if !matches!(theme.as_str(), "light" | "dark") {
        return Err("invalid_theme".into());
    }
    *UI_THEME.lock().unwrap() = Some(theme);
    for (_, win) in app.webview_windows() {
        if win.label().starts_with("popup-") {
            let _ = win.eval(theme_js());
        }
    }
    Ok(())
}

/// Погасить попапы источника: портал зовёт при открытии беседы ИЛИ письма
/// (#618, модель Telegram — открыл источник, его уведомления не висят
/// устаревшими). Только закрывает окна/вычищает очередь, ничего не создаёт.
#[tauri::command]
pub fn dismiss_popups(app: AppHandle, conversation_id: String) -> Result<(), String> {
    if !is_valid_conversation(&conversation_id) {
        return Err("invalid_payload".into());
    }
    popups::dismiss_for_target(&app, &conversation_id);
    Ok(())
}

#[tauri::command]
pub fn flash_taskbar(app: AppHandle, critical: bool) {
    if let Some(win) = app.get_webview_window("main") {
        let attention = if critical {
            UserAttentionType::Critical
        } else {
            UserAttentionType::Informational
        };
        if let Err(e) = win.request_user_attention(Some(attention)) {
            log::warn!("мигание таскбара не удалось: {e}");
        }
    }
}

/// Открыть ссылку системным приложением: http/https (браузер), mailto (почта),
/// tel (телефон). Deep link'и портала остаются в приложении, произвольные
/// схемы и file:// запрещены.
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "invalid_url")?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto" | "tel") {
        return Err("invalid_url".into());
    }
    app.opener()
        .open_url(parsed.to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellInfo {
    pub version: String,
    pub platform: String,
}

#[tauri::command]
pub fn get_shell_info(app: AppHandle) -> ShellInfo {
    ShellInfo {
        version: app.package_info().version.to_string(),
        platform: std::env::consts::OS.into(),
    }
}

/// Веб-приложение армировало слушателей моста: доставить отложенный deep link
/// и повторить доставку состояния обновлений (события могли потеряться до
/// монтирования слушателя).
#[tauri::command]
pub fn shell_ready(app: AppHandle) {
    if let Some(link) = portal::take_pending_deep_link(&app) {
        route_deep_link(&app, &link);
    }
    crate::updates::on_portal_ready(&app);
}

/// Разбор `nodus://chat/<uuid>` и доставка в веб (или очередь до готовности).
pub fn route_deep_link(app: &AppHandle, raw: &str) {
    let Ok(url) = tauri::Url::parse(raw) else {
        log::warn!("некорректный deep link: {raw}");
        return;
    };
    if url.scheme() != "nodus" {
        return;
    }
    let conversation_id = match url.host_str() {
        Some("chat") => url.path().trim_start_matches('/').to_string(),
        _ => {
            log::info!("deep link без обработчика: {raw}");
            return;
        }
    };
    if conversation_id.is_empty() {
        return;
    }
    if !portal::is_ready(app) {
        portal::set_pending_deep_link(app, raw.to_string());
        crate::show_main(app);
        return;
    }
    crate::show_main(app);
    push_to_portal(
        app,
        "open-conversation",
        &serde_json::json!({ "conversationId": conversation_id }),
    );
}
