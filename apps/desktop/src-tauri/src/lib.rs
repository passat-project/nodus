mod activity;
mod anchor;
mod badge;
mod bridge;
mod deep_link;
mod downloads;
mod fade;
mod layout;
mod popups;
mod portal;
mod state;
mod tray_menu;
mod updates;

use std::sync::Mutex;

use tauri::webview::NewWindowResponse;
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
        // JS-перехват `<a target="_blank">` выключен (#644): плагин глушил
        // клики — его `open_url` отклоняется ACL портала, и ошибка не видна.
        // Ссылки обрабатывает само приложение (use-link-interception) через
        // разрешённый мост open_external; новые окна — on_new_window ниже.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
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
            downloads::popup_reveal_download,
        ])
        .run(tauri::generate_context!())
        .expect("оболочка Nodus упала");
}

/// Главное окно: локальный мини-UI (экран подключения) с мостом и гвардом
/// навигации; портал подключается поверх через `navigate` (portal.rs).
fn create_main_window(app: &AppHandle) -> tauri::Result<()> {
    let version = app.package_info().version.to_string();
    let nav_app = app.clone();
    let new_window_app = app.clone();
    let download_app = app.clone();
    let win =
        tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
            .title("Nodus")
            .inner_size(1280.0, 800.0)
            .min_inner_size(1024.0, 660.0)
            .center()
            .visible(false)
            // HTML5 drag&drop файлов (#716): tauri по умолчанию подменяет
            // drop-обработчик WebView2 своим (DragDropEvent) — на Windows
            // нативные DOM-события дропа не приходят, и чат не принимает файл
            // из Проводника. Метод документирован ровно для этого
            // (tauri 2.12.1: WebviewWindowBuilder::disable_drag_drop_handler).
            .disable_drag_drop_handler()
            .additional_browser_args(WEBVIEW2_BROWSER_ARGS)
            .initialization_script(bridge::initialization_script(&version))
            .on_navigation(move |url| navigation_allowed(&nav_app, url))
            // Страховка (#644): если ссылка всё же запросила новое окно
            // (правый клик «открыть в новом окне», библиотечный window.open) —
            // открываем системным приложением, окно WebView2 не создаём.
            .on_new_window(move |url, _features| {
                open_in_system(&new_window_app, &url);
                NewWindowResponse::Deny
            })
            // Скачивания (#647): wry по умолчанию молча кладёт файл в
            // «Загрузки» (download_completed_handler = None) — на завершении
            // показываем попап оболочки. Обработчик синхронный (event loop),
            // поэтому окно попапа создаём ТОЛЬКО из async-контекста (gotcha).
            .on_download(move |_webview, event| {
                if let tauri::webview::DownloadEvent::Finished { url, path, success } = event {
                    let app = download_app.clone();
                    tauri::async_runtime::spawn(async move {
                        downloads::notify_finished(&app, &url, path, success);
                    });
                }
                true
            })
            .build()?;
    let _ = win.show();
    Ok(())
}

/// Открыть ссылку системным приложением: браузер (http/https), почта
/// (mailto), телефон (tel). Прочие схемы игнорируются — security-рамка
/// ADR-0019 (никаких file:// и произвольных протоколов).
fn open_in_system(app: &AppHandle, url: &Url) {
    if !matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
        return;
    }
    if let Err(e) = app.opener().open_url(url.to_string(), None::<&str>) {
        log::warn!("ссылка не открыта: {e}");
    }
}

/// Локальный мини-UI оболочки: схемы приложения И точный host
/// `tauri.localhost`. Схема проверяется ДО host намеренно (#716): с нативным
/// HTML5 drag&drop WebView2 навигирует на `file://`-URL брошенного файла, и
/// UNC-форма `file://tauri.localhost/…` иначе сошла бы за локальный UI и
/// загрузила сторонний HTML в окно с внедрённым мостом (security-ревью #716).
fn is_local_ui_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "tauri") && url.host_str() == Some("tauri.localhost")
}

/// Гвард навигации: локальный мини-UI и origin портала — можно; всё прочее —
/// в системный браузер, webview остаётся на портале (security-рамка ADR-0019).
fn navigation_allowed(app: &AppHandle, url: &Url) -> bool {
    if is_local_ui_url(url) {
        return true;
    }
    // `file:` внешнему обработчику не отдаём (open_in_system пускает только
    // http/https/mailto/tel), mailto:/tel: — по-прежнему уходят в систему.
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
    open_in_system(app, url);
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

#[cfg(test)]
mod navigation_tests {
    use super::is_local_ui_url;
    use tauri::Url;

    /// Таблица гварда навигации (#716): локальный UI — только схемы приложения
    /// с точным host; file://-формы (в т.ч. UNC-подмена host) и чужие хосты —
    /// отказ (иначе сторонний HTML грузится в окно с мостом оболочки).
    #[test]
    fn local_ui_url_checks_scheme_before_host() {
        let allowed = [
            "http://tauri.localhost/index.html",
            "https://tauri.localhost/index.html",
        ];
        for raw in allowed {
            assert!(
                is_local_ui_url(&Url::parse(raw).unwrap()),
                "должен пройти: {raw}"
            );
        }
        let denied = [
            "file://tauri.localhost/share/evil.html",
            "file:///C:/Windows/evil.html",
            "http://tauri.localhost.evil.com/",
            "https://example.com/",
            "data:text/html,<script>1</script>",
        ];
        for raw in denied {
            assert!(
                !is_local_ui_url(&Url::parse(raw).unwrap()),
                "должен отклониться: {raw}"
            );
        }
    }
}
