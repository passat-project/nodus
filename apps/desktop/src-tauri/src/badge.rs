use tauri::image::Image;
use tauri::{AppHandle, Manager};

use crate::tray_menu;

/// Незначимый красный (тон destructive в hex — рендер вне CSS-токенов):
/// бейдж — пиксельная графика иконки, а не DOM.
const BADGE_RED: [u8; 4] = [229, 72, 77, 255];
const BADGE_WHITE: [u8; 4] = [255, 255, 255, 255];

/// 3×5 пиксельный шрифт цифр: 15 символов на глиф, row-major, ПЕРВЫЙ
/// символ — левый верх (строковые глифы вместо битовых масок: сдвиг
/// `row*3+col` читал битовое представление снизу вверх — цифры зеркалились
/// по вертикали в бейджах трея и панели задач).
const DIGITS: [&str; 10] = [
    "111101101101111", // 0
    "010110010010111", // 1
    "111001111100111", // 2
    "111001111001111", // 3
    "101101111001001", // 4
    "111100111001111", // 5
    "111100111101111", // 6
    "111001001001001", // 7
    "111101111101111", // 8
    "111101111001111", // 9
];

struct Rgba {
    data: Vec<u8>,
    width: u32,
    height: u32,
}

impl Rgba {
    fn new(width: u32, height: u32) -> Self {
        Self {
            data: vec![0; (width * height * 4) as usize],
            width,
            height,
        }
    }
    fn put(&mut self, x: i32, y: i32, color: [u8; 4]) {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 {
            return;
        }
        let idx = ((y as u32 * self.width + x as u32) * 4) as usize;
        let alpha = color[3] as u32;
        let [old_r, old_g, old_b, old_a] = [
            self.data[idx] as u32,
            self.data[idx + 1] as u32,
            self.data[idx + 2] as u32,
            self.data[idx + 3] as u32,
        ];
        // Альфа-смешивание для мягкой кромки круга (1px); u32 обязательна:
        // 255 * 255 * 255 не помещается в u16 (паника переполнения в debug).
        let out_a = alpha + (old_a * (255 - alpha) / 255);
        if out_a == 0 {
            return;
        }
        for c in 0..3 {
            let src = color[c] as u32 * alpha;
            let old_c = [old_r, old_g, old_b][c];
            let dst = old_c * old_a * (255 - alpha) / 255;
            self.data[idx + c] = ((src + dst) / out_a) as u8;
        }
        self.data[idx + 3] = out_a as u8;
    }
    fn into_image(self) -> Image<'static> {
        Image::new_owned(self.data, self.width, self.height)
    }
}

/// Круг с расстояния-сглаженной кромкой.
fn fill_circle(buf: &mut Rgba, cx: f32, cy: f32, radius: f32, color: [u8; 4]) {
    let min_x = (cx - radius - 1.0).floor() as i32;
    let max_x = (cx + radius + 1.0).ceil() as i32;
    let min_y = (cy - radius - 1.0).floor() as i32;
    let max_y = (cy + radius + 1.0).ceil() as i32;
    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let dist = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
            let coverage = (radius - dist + 0.5).clamp(0.0, 1.0);
            if coverage > 0.0 {
                let mut c = color;
                c[3] = (coverage * color[3] as f32).round() as u8;
                buf.put(x, y, c);
            }
        }
    }
}

/// Цифры (+ «9+»): масштаб целый, центрируем в круг.
fn draw_counter(buf: &mut Rgba, cx: f32, cy: f32, count: u32, scale: i32) {
    let text: Vec<&str> = if count >= 10 {
        // две цифры; 100+ → «9+»
        if count >= 100 {
            vec![DIGITS[9], ""] // хвост — глиф «+» ниже
        } else {
            vec![DIGITS[(count / 10) as usize], DIGITS[(count % 10) as usize]]
        }
    } else {
        vec![DIGITS[count as usize]]
    };
    let is_plus_tail = count >= 100;
    let glyph_w = 3 * scale;
    let glyph_h = 5 * scale;
    let total_w = (text.len() as i32 * glyph_w + (text.len() as i32 - 1).max(0) * scale) as f32;
    let mut dx = cx - total_w / 2.0;
    for (i, glyph) in text.iter().enumerate() {
        if i > 0 {
            dx += scale as f32; // межцифровой зазор
        }
        for row in 0..5usize {
            for col in 0..3usize {
                let is_plus = is_plus_tail && i == 1;
                let on = if is_plus {
                    // плюс 3×5: вертикаль и горизонталь
                    (col == 1 && (1..4).contains(&row)) || (row == 2 && (0..3).contains(&col))
                } else {
                    glyph.as_bytes()[row * 3 + col] == b'1'
                };
                if on {
                    for sy in 0..scale {
                        for sx in 0..scale {
                            let px = dx as i32 + col as i32 * scale + sx;
                            let py = cy as i32 - glyph_h / 2 + row as i32 * scale + sy;
                            buf.put(px, py, BADGE_WHITE);
                        }
                    }
                }
            }
        }
        dx += glyph_w as f32;
    }
}

/// Геометрия бейджа панели задач: (радиус круга, масштаб цифр) — заливка
/// чуть крупнее при мелкой цифре (фидбек 08.10: «диаметр заливки увеличить,
/// цифру не увеличивать»); двухзначному числу круг шире, чтобы «99» не резало
/// углы. В трее бейджа НЕТ (закрывал знак-график — вердикт владельца 08.10).
fn taskbar_geom(count: u32) -> (f32, i32) {
    if (10..100).contains(&count) {
        (9.0, 2)
    } else {
        (8.0, 2)
    }
}

/// Значок-бейдж отдельной картинкой (оверлей панели задач, 24×24): круг в
/// правом-нижнем углу канваса — Windows дорисовывает оверлей у угла кнопки.
fn overlay_icon(count: u32) -> Image<'static> {
    let size = 24;
    let (r, scale) = taskbar_geom(count);
    let mut buf = Rgba::new(size, size);
    let cx = size as f32 - r - 1.0;
    let cy = size as f32 - r - 1.0;
    fill_circle(&mut buf, cx, cy, r, BADGE_RED);
    draw_counter(&mut buf, cx, cy, count, scale);
    buf.into_image()
}

/// Применить счётчик непрочитанных (фидбек 08.10: счётчик ТОЛЬКО на панели
/// задач — оверлей; в трее чистый знак, он бейдж не вмещает без ущерба
/// знаку-графику). 0/None — чистые иконки.
pub fn apply(app: &AppHandle, count: Option<u32>) {
    match count.filter(|c| *c > 0) {
        Some(n) => {
            tray_menu::set_tray_icon(app, base_icon());
            tray_menu::set_tray_tooltip(app, &format!("Nodus — {n} непрочитанных"));
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_overlay_icon(Some(overlay_icon(n)));
            }
        }
        None => {
            tray_menu::set_tray_icon(app, base_icon());
            tray_menu::set_tray_tooltip(app, "Nodus");
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_overlay_icon(None::<Image>);
            }
        }
    }
}

fn decode_png(bytes: &'static [u8]) -> Image<'static> {
    let img = image::load_from_memory(bytes).expect("иконка встроена в сборку");
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    Image::new_owned(rgba.into_raw(), w, h)
}

/// Единый значок приложения (#263, вердикт владельца 09.10): тёмно-синяя
/// скруглённая плитка с белым знаком — одинаков на тёмной и светлой теме
/// Windows; отсюда трей, окно и панель задач берут одну картинку. Мастер —
/// docs/design/logo/Nodus_значок_приложения.svg, набор генерирует
/// `tauri icon` (перегенерация правит ВСЕ размеры разом).
pub fn base_icon() -> Image<'static> {
    static UNIFIED: &[u8] = include_bytes!("../icons/32x32.png");
    decode_png(UNIFIED)
}

/// Визуальный регресс бейджей (урок приёмки #254: пиксели правятся только
/// по глазам): cargo test пишет PNG в target/badge-preview/ — трей поверх
/// знака и оверлей панели задач для 1/2-значных счётчиков.
#[cfg(test)]
mod badge_previews {
    use super::*;

    #[test]
    fn пишем_png_превью_в_target() {
        let target = std::env::var("CARGO_TARGET_DIR").unwrap_or_else(|_| "target".into());
        let dir = std::path::Path::new(&target).join("badge-preview");
        std::fs::create_dir_all(&dir).unwrap();
        for count in [3, 27] {
            let img = overlay_icon(count);
            let path = dir.join(format!("taskbar-{count}.png"));
            image::RgbaImage::from_raw(img.width(), img.height(), img.rgba().to_vec())
                .unwrap()
                .save(&path)
                .unwrap();
        }
    }
}
