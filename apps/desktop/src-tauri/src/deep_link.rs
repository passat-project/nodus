use tauri::AppHandle;
use tauri_plugin_deep_link::DeepLinkExt;

/// Схема deep link из конфига Tauri (`plugins.deep-link.desktop.schemes`).
/// `None` — регистрацию НЕ делаем: бета-сборка (`tauri.beta.conf.json`) не
/// должна перехватывать `nodus://` у установленной оболочки, а своей схемы ей
/// не нужно (маршрутизация в `bridge::route_deep_link` знает только `nodus://`).
/// Секции нет вовсе — канонический `nodus` (поведение продукта не меняется).
fn scheme_from_config(plugin: Option<&serde_json::Value>) -> Option<String> {
    let schemes = plugin
        .and_then(|value| value.get("desktop"))
        .and_then(|value| value.get("schemes"))
        .and_then(|value| value.as_array());
    match schemes {
        None => Some("nodus".to_string()),
        // Пустой список — явное «deep link не нужен».
        Some(list) if list.is_empty() => None,
        Some(list) => Some(
            list.first()
                .and_then(|scheme| scheme.as_str())
                .unwrap_or("nodus")
                .to_string(),
        ),
    }
}

fn configured_scheme(app: &AppHandle) -> Option<String> {
    scheme_from_config(app.config().plugins.0.get("deep-link"))
}

/// Схема deep link (плагин deep-link): холодный старт + регистрация схемы
/// в реестре (ремень+подтяжки для portable/dev-запусков; установщик тоже
/// регистрирует). Разбор и доставка — bridge::route_deep_link.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    match configured_scheme(app) {
        Some(scheme) => {
            if let Err(e) = app.deep_link().register(&scheme) {
                log::warn!("схема {scheme}:// не зарегистрирована: {e}");
            }
        }
        None => log::info!("схема deep link отключена конфигом (schemes: [])"),
    }
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            crate::bridge::route_deep_link(app, url.as_str());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::scheme_from_config;
    use serde_json::json;

    /// Схема берётся из конфига плагина: продукт — `nodus`; пустой список —
    /// отключение (бета не должна перехватывать `nodus://`); мусор в первом
    /// элементе — продуктовый фолбэк, чтобы опечатка не убивала deep link.
    #[test]
    fn схема_читается_из_конфига_плагина() {
        assert_eq!(
            scheme_from_config(Some(&json!({"desktop": {"schemes": ["nodus"]}}))).as_deref(),
            Some("nodus")
        );
        // Секции/ключей нет — поведение продукта по умолчанию.
        assert_eq!(scheme_from_config(None).as_deref(), Some("nodus"));
        assert_eq!(
            scheme_from_config(Some(&json!({}))).as_deref(),
            Some("nodus")
        );
        assert_eq!(
            scheme_from_config(Some(&json!({"desktop": {}}))).as_deref(),
            Some("nodus")
        );
        // Явное отключение — регистрацию не делаем (бета-сборка).
        assert_eq!(
            scheme_from_config(Some(&json!({"desktop": {"schemes": []}}))),
            None
        );
        // Мусор вместо схемы — фолбэк, а не тихое отключение.
        assert_eq!(
            scheme_from_config(Some(&json!({"desktop": {"schemes": [42]}}))).as_deref(),
            Some("nodus")
        );
    }
}
