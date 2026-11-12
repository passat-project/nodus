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
    logPopupDecision: function (p) {{ return invoke('log_popup_diagnostic', {{ payload: p }}); }},
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
        .permission("allow-log-popup-diagnostic")
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
    /// Абсолютный путь скачанного файла (для reveal). `skip_serializing` —
    /// инвариант «путь только в Rust» держится типом, а не местом вызова.
    #[serde(default, skip_serializing)]
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
    // Диагностика (#811): событие дошло до оболочки. В лог — только id/цель/
    // срочность; текст сообщения и имя автора в лог не попадают (приватность,
    // публичный репозиторий).
    log::info!(
        "notify_popup: id={} conversation={:?} letter={:?} threadRoot={:?} urgent={}",
        payload.id,
        payload.conversation_id,
        payload.letter_id,
        payload.thread_root_id,
        payload.urgent
    );
    // Граница контракта на Rust-стороне (security-аудит #254, подозрение 5).
    // Цель — ровно одна (#618): беседа ИЛИ письмо, обе/ни одной — отказ.
    // Скачивание (#647) портал не создаёт вовсе: такую карточку показывает
    // только оболочка по своему событию загрузки — путь файла приходит не из
    // веб-контента.
    if let Some(reason) = payload_invalid_reason(&payload) {
        // Причина отказа — кодом: веб пишет её в диагностику (#811), владелец
        // видит, что попап отклонила оболочка, а не «потерялся».
        log::warn!(
            "notify_popup отклонён: reason={} id={} conversation={:?} letter={:?}",
            reason,
            payload.id,
            payload.conversation_id,
            payload.letter_id
        );
        return Err("invalid_payload".into());
    }
    popups::show(&app, payload);
    log::info!("notify_popup принят оболочкой (окно создано или в очереди)");
    Ok(())
}

/// Причина отказа контракта попапа — стабильный код (для лога и диагностики
/// веба). `None` — payload валиден. Текст сообщения не читается.
fn payload_invalid_reason(payload: &PopupPayload) -> Option<&'static str> {
    let target_ok = match (
        payload.conversation_id.as_deref(),
        payload.letter_id.as_deref(),
    ) {
        (Some(c), None) => is_valid_conversation(c),
        (None, Some(l)) => is_valid_conversation(l),
        _ => false,
    };
    if payload.id.is_empty() {
        return Some("id_empty");
    }
    if payload.id.len() > 200 {
        return Some("id_too_long");
    }
    if !target_ok {
        return Some("target");
    }
    if payload.download.is_some() {
        return Some("download_forbidden");
    }
    if payload
        .thread_root_id
        .as_deref()
        .is_some_and(|t| !is_valid_conversation(t))
    {
        return Some("thread_root");
    }
    if payload.title.is_empty() {
        return Some("title_empty");
    }
    if payload.title.chars().count() > 200 {
        return Some("title_too_long");
    }
    if payload.preview.chars().count() > 500 {
        return Some("preview_too_long");
    }
    if payload
        .avatar_url
        .as_deref()
        .is_some_and(|u| u.len() > 2000)
    {
        return Some("avatar_url_too_long");
    }
    None
}

/// Диагностика решения гейта попапа (#811, веб → оболочка): зеркало
/// contracts `popupDiagnosticSchema`. Только id и стабильные коды причин —
/// текста сообщений/имён здесь нет и быть не может (приватность, публичный репозиторий).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PopupDiagnostic {
    pub message_id: Option<String>,
    pub conversation_id: Option<String>,
    pub reason: String,
    pub detail: Option<String>,
}

/// Закрытый список причин: неизвестная строка не попадает в лог (инъекция).
const POPUP_DIAGNOSTIC_REASONS: [&str; 10] = [
    "not_shell",
    "invalid_payload",
    "own",
    "not_active",
    "looking",
    "muted",
    "snoozed",
    "thread_wait",
    "sent",
    "rejected",
];

/// Поле лога: управляющие символы (переводы строк, ANSI) — в пробел, длина ≤ 120.
fn log_field(value: Option<&str>) -> String {
    let mut out: String = value
        .unwrap_or("-")
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(120)
        .collect();
    if out.is_empty() {
        out.push('-');
    }
    out
}

/// Записать решение гейта попапа в лог оболочки (#811). Best-effort: команда
/// не возвращает ошибок и не влияет на попапы — только строка `popup_decision:`
/// в `nodus-desktop.log` (включать ничего не нужно, лог всегда пишется).
#[tauri::command]
pub fn log_popup_diagnostic(payload: PopupDiagnostic) {
    if !POPUP_DIAGNOSTIC_REASONS.contains(&payload.reason.as_str()) {
        log::warn!("popup_decision: reason=unknown (отклонено)");
        return;
    }
    log::info!(
        "popup_decision: reason={} message={} conversation={} detail={}",
        payload.reason,
        log_field(payload.message_id.as_deref()),
        log_field(payload.conversation_id.as_deref()),
        log_field(payload.detail.as_deref())
    );
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

#[cfg(test)]
mod tests {
    use super::*;

    const CONV: &str = "00000000-0000-4000-8000-0000000000c1";

    fn payload() -> PopupPayload {
        PopupPayload {
            id: "m1".into(),
            conversation_id: Some(CONV.into()),
            letter_id: None,
            thread_root_id: None,
            title: "Иван Петров".into(),
            avatar_url: None,
            preview: "Привет".into(),
            preview_attachment: None,
            urgent: false,
            can_reply: true,
            download: None,
        }
    }

    #[test]
    fn log_field_sanitizes_and_truncates() {
        assert_eq!(log_field(None), "-");
        assert_eq!(log_field(Some("")), "-");
        assert_eq!(log_field(Some("a\nb\tc")), "a b c");
        assert_eq!(log_field(Some(&"x".repeat(200))).chars().count(), 120);
    }

    #[test]
    fn valid_payload_has_no_reason() {
        assert_eq!(payload_invalid_reason(&payload()), None);
    }

    #[test]
    fn reasons_are_stable_codes() {
        let mut empty_title = payload();
        empty_title.title.clear();
        assert_eq!(
            payload_invalid_reason(&empty_title),
            Some("title_empty")
        );

        let mut long_preview = payload();
        long_preview.preview = "x".repeat(501);
        assert_eq!(
            payload_invalid_reason(&long_preview),
            Some("preview_too_long")
        );

        let mut two_targets = payload();
        two_targets.letter_id = Some(CONV.into());
        assert_eq!(payload_invalid_reason(&two_targets), Some("target"));

        let mut no_target = payload();
        no_target.conversation_id = None;
        assert_eq!(payload_invalid_reason(&no_target), Some("target"));

        let mut empty_id = payload();
        empty_id.id.clear();
        assert_eq!(payload_invalid_reason(&empty_id), Some("id_empty"));

        let mut bad_thread = payload();
        bad_thread.thread_root_id = Some("not-a-uuid".into());
        assert_eq!(
            payload_invalid_reason(&bad_thread),
            Some("thread_root")
        );
    }
}
