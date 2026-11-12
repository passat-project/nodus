use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt as _;

use crate::updates;

/// Пункт «Проверить обновления»: у TrayIcon нет геттера меню — держим хэндл
/// (items ref-counted), чтобы переименовать в «Перезапустить (версия)» (#263).
static UPDATE_ITEM: std::sync::Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>> =
    std::sync::Mutex::new(None);

/// Трей: «Открыть Nodus», «Запускать при входе в Windows» (чекбокс),
/// «Проверить обновления», «Сменить сервер…», «Выход». ЛКМ по значку —
/// показать окно; закрытие окна всегда прячет в трей (lib.rs).
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    // Имя — из productName конфига: бета-сборка показывает свой трей и не
    // путается с продуктовой оболочкой (см. crate::display_name).
    let name = crate::display_name(app);
    let open = MenuItem::with_id(app, "open", format!("Открыть {name}"), true, None::<&str>)?;
    let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "Запускать при входе в Windows",
        true,
        autostart_enabled,
        None::<&str>,
    )?;
    let update = MenuItem::with_id(app, "update", "Проверить обновления", true, None::<&str>)?;
    *UPDATE_ITEM.lock().unwrap() = Some(update.clone());
    let reload = MenuItem::with_id(app, "reload", "Перезагрузить портал", true, None::<&str>)?;
    let change = MenuItem::with_id(app, "change_server", "Сменить сервер…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &autostart, &update, &reload, &change, &quit])?;

    let icon = crate::badge::base_icon();
    TrayIconBuilder::with_id("nodus-tray")
        .icon(icon)
        .tooltip(&name)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => crate::show_main(app),
            "autostart" => toggle_autostart(app),
            "update" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    // Скачанное обновление (#263) — пункт становится
                    // «Перезапустить (версия)»: клик = passive-установка.
                    if updates::has_prepared() {
                        if let Err(e) = updates::apply_prepared() {
                            log::warn!("установка обновления не удалась: {e}");
                        }
                    } else if let Err(e) = updates::check_and_prepare(&app).await {
                        log::warn!("проверка обновлений не удалась: {e}");
                    }
                });
            }
            "reload" => {
                // Recovery (ADR-0019 Ф4): краш рендера лечится перезагрузкой
                // webview — сессия портала переживает reload (refresh-cookie).
                if let Some(win) = app.get_webview_window("main") {
                    if let Err(e) = win.eval("location.reload()") {
                        log::warn!("перезагрузка портала не удалась: {e}");
                    }
                }
            }
            "change_server" => crate::portal::change_server(app.clone()),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                crate::show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn toggle_autostart(app: &AppHandle) {
    let autolaunch = app.autolaunch();
    let result = if autolaunch.is_enabled().unwrap_or(false) {
        autolaunch.disable()
    } else {
        autolaunch.enable()
    };
    if let Err(e) = result {
        log::warn!("переключение автозапуска не удалось: {e}");
    }
}

/// Бейдж непрочитанных: смена иконки трея (badge.rs рисует).
pub fn set_tray_icon(app: &AppHandle, icon: Image<'_>) {
    if let Some(tray) = app.tray_by_id("nodus-tray") {
        if let Err(e) = tray.set_icon(Some(icon)) {
            log::warn!("иконка трея не обновлена: {e}");
        }
    }
}

pub fn set_tray_tooltip(app: &AppHandle, tooltip: &str) {
    if let Some(tray) = app.tray_by_id("nodus-tray") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}

/// Обновление скачано и ждёт решения (#263): пункт «Проверить обновления»
/// становится «Перезапустить (версия)» — тот же id, клик ставит и возвращает
/// приложение (passive-установщик).
pub fn mark_update_ready(app: &AppHandle) {
    let Some(version) = updates::pending_version() else {
        return;
    };
    if let Some(item) = UPDATE_ITEM.lock().unwrap().as_ref() {
        if let Err(e) = item.set_text(format!("Перезапустить ({version})")) {
            log::warn!("подпись пункта обновления трея не изменена: {e}");
        }
    }
    set_tray_tooltip(app, &format!("Nodus — {version} доступна"));
}
