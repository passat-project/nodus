mod activity;
mod anchor;
mod badge;
mod bridge;
mod deep_link;
mod fade;
mod layout;
mod popups;
mod portal;
mod state;
mod tray_menu;
mod updates;

use std::sync::Mutex;

use tauri::{AppHandle, Manager, Url, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_opener::OpenerExt;

use state::ShellState;

/// Аргументы браузерного процесса WebView2 — ОДНИ для всех окон (окна делят
/// data directory, разные аргументы = отказ создания окна). Заменяют дефолт
/// wry, поэтому его отключения и автоплей повторены явно. HideCursorWhileTyping
/// (Chromium 152+, «скрывать указатель при вводе») в HWND-хостинге WebView2
/// гасит каретку при наборе (#309; WebView2Feedback #5687/#5708).
pub(crate) const WEBVIEW2_BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HideCursorWhileTyping --autoplay-policy=no-user-gesture-required";

/// Точка сборки оболочки (ADR-0019): тонкий клиент портала. Порядок плагинов:
/// single-instance первым (канон плагина); лог перехватывает паники в файл.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Второй инстанс: пробрасываем deep link в живую оболочку.
            if let Some(link) = argv.iter().find(|a| a.starts_with("nodus://")) {
                bridge::route_deep_link(app, link);
            } else {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("nodus-desktop.log".into()),
                    }),
                ])
                .max_file_size(8_000_000)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ShellState::default())
        .manage(Mutex::new(popups::PopupStack::default()))
        .setup(|app| {
            let handle = app.handle().clone();
            create_main_window(&handle)?;
            tray_menu::setup(&handle)?;
            deep_link::setup(&handle)?;
            // Активность пользователя (клик/клавиша, без движения мыши) —
            // арбитр угасания попапов (#254, модель Telegram).
            activity::start();
            // Точка обновления в долгих сессиях: периодическая проверка
            // (стартовая и on_portal_ready уже позади, #263).
            updates::start_periodic_check(handle.clone());
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Закрытие главного окна = скрыть в трей (соединение и состояние живут).
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
                bridge::push_to_portal(
                    window.app_handle(),
                    "shell-visibility",
                    &serde_json::json!({ "visible": false }),
                );
            }
            WindowEvent::Destroyed if window.label().starts_with("popup-") => {
                popups::on_popup_destroyed(window.app_handle(), window.label());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            portal::get_connection_state,
            portal::submit_portal_address,
            portal::retry_connection,
            portal::change_server,
            updates::run_updater,
            updates::get_update_state,
            updates::apply_update,
            bridge::notify_popup,
            bridge::set_unread_badge,
            bridge::flash_taskbar,
            bridge::open_external,
            bridge::dismiss_popups,
            bridge::set_ui_theme,
            bridge::get_shell_info,
            bridge::shell_ready,
            popups::popup_get_data,
            popups::popup_ready,
            popups::popup_close,
            popups::popup_set_expanded,
            popups::popup_set_height,
            popups::popup_set_hover,
            popups::popup_close_all,
            popups::popup_submit_reply,
            popups::popup_open,
        ])
        .run(tauri::generate_context!())
        .expect("оболочка Nodus упала");
}

/// Главное окно: локальный мини-UI (экран подключения) с мостом и гвардом
/// навигации; портал подключается поверх через `navigate` (portal.rs).
fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    let version = app.package_info().version.to_string();
    let nav_app = app.clone();
    let win =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("Nodus")
            .inner_size(1280.0, 800.0)
            .min_inner_size(1024.0, 660.0)
            .center()
            .visible(false)
            .additional_browser_args(WEBVIEW2_BROWSER_ARGS)
            .initialization_script(bridge::initialization_script(&version))
            .on_navigation(move |url| navigation_allowed(&nav_app, url))
            .build()?;
    let _ = win.show();
    Ok(())
}

/// Гвард навигации: локальный мини-UI и origin портала — можно; всё прочее —
/// в системный браузер, webview остаётся на портале (security-рамка ADR-0019).
fn navigation_allowed(app: &AppHandle, url: &Url) -> bool {
    if url.host_str() == Some("tauri.localhost") {
        return true;
    }
    if let Some(root) = portal::portal_root(app) {
        if let Ok(root_url) = Url::parse(&root) {
            let same_origin = url.scheme() == root_url.scheme()
                && url.host_str() == root_url.host_str()
                && url.port_or_known_default() == root_url.port_or_known_default();
            if same_origin {
                return true;
            }
        }
    }
    if matches!(url.scheme(), "http" | "https") {
        if let Err(e) = app.opener().open_url(url.to_string(), None::<&str>) {
            log::warn!("внешняя ссылка не открыта: {e}");
        }
    }
    false
}

/// Показать главное окно (из трея/deep link'а) и уведомить портал о видимости.
pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
    bridge::push_to_portal(
        app,
        "shell-visibility",
        &serde_json::json!({ "visible": true }),
    );
}
