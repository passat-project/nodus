/**
 * Словарь фоновых иконок зоны чата (#849).
 *
 * Основной источник — Lucide 1.66 (ISC, уже в проекте как lucide-react).
 * Геометрия берётся из установленного пакета (per-icon модули `__iconData`),
 * в репозиторий попадает только сгенерированный SVG-ассет — см. LICENSES.md.
 *
 * Custom (6) — только то, чего в Lucide нет: кран, экскаватор, конвейер,
 * труба, жилет, уровень. Плюс фирменный знак Nodus с окна входа.
 * Все на сетке 24×24; штрих на плитке задаётся генератором (1.15).
 */
const CUSTOM = {
  // Башенный кран — геометрия Tabler Icons 3.34 (MIT), чтобы не рисовать
  // вручную: единый характер штриха с Lucide, лицензия совместима.
  crane: `<path d="M6 21h6"/><path d="M9 21v-18l-6 6h18"/><path d="M9 3l10 6"/><path d="M17 9v4a2 2 0 1 1-2 2"/>`,

  // Экскаватор: гусеница → кабина → стрела → ковш.
  excavator: `<path d="M4.5 17h9a2 2 0 0 1 0 4h-9a2 2 0 0 1 0-4Z"/><path d="M5 17v-5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v5"/><path d="M10.5 13.5 15.5 7l3 5.5"/><path d="M17 14l4-.8-.7 3.4-3.3-.8"/>`,

  // Конвейер: лента с двумя роликами, опоры, короб на ленте.
  conveyor: `<circle cx="5" cy="15" r="2"/><circle cx="19" cy="15" r="2"/><path d="M5 13h14M5 17h14"/><path d="M6.5 17.5 5 21M17.5 17.5 19 21"/><path d="M9 13V8h5v5"/>`,

  // Труба-отвод с фланцами на открытых концах.
  pipe: `<path d="M5 21V12a7 7 0 0 1 7-7h9"/><path d="M9 21V12a3 3 0 0 1 3-3h9"/><path d="M3.5 21h7M21 3.5v7"/>`,

  // Сигнальный жилет: вырез, плечи, две светоотражающие полосы.
  vest: `<path d="M9 3 4.5 5.5 6 10l2.5-1.2V21h7V8.8L18 10l1.5-4.5L15 3l-3 2-3-2Z"/><path d="M8.5 12.5h7M8.5 16h7"/>`,

  // Пузырьковый уровень: корпус, окно, пузырёк.
  level: `<rect x="2" y="9" width="20" height="6" rx="1.5"/><rect x="8" y="10.5" width="8" height="3" rx="1.5"/><circle cx="12" cy="12" r="1" fill="#000" stroke="none"/>`,
};

/** Ключ → Lucide kebab-имя. Порядок = порядок словаря на контактных листах. */
const LUCIDE = {
  folder: ['Папка', 'folder'],
  doc: ['Документ', 'file-text'],
  envelope: ['Письмо', 'mail'],
  task: ['Задача', 'square-check'],
  chat: ['Чат', 'message-square'],
  calendar: ['Календарь', 'calendar-days'],
  paperclip: ['Скрепка', 'paperclip'],
  person: ['Сотрудник', 'user'],
  clock: ['Время', 'clock'],
  bell: ['Уведомление', 'bell'],
  pin: ['Локация', 'map-pin'],
  search: ['Поиск', 'search'],
  kanban: ['Канбан', 'kanban'],
  list: ['Список', 'list'],
  sliders: ['Настройки', 'sliders-horizontal'],
  book: ['База знаний', 'book-open'],
  key: ['Доступ', 'key-round'],
  bulb: ['Идея', 'lightbulb'],
  coffee: ['Кофе', 'coffee'],
  helmet: ['Каска', 'hard-hat'],
  building: ['Здание', 'building-2'],
  ruler: ['Линейка', 'ruler'],
  blueprint: ['Чертёж', 'drafting-compass'],
  bricks: ['Кирпичи', 'brick-wall'],
  cone: ['Конус', 'traffic-cone'],
  graph: ['Граф', 'chart-network'],
  org: ['Структура', 'network'],
  bars: ['График', 'chart-column'],
  pie: ['Диаграмма', 'chart-pie'],
  flow: ['Маршрут', 'route'],
  star: ['Звезда', 'star'],
  shield: ['Согласование', 'shield-check'],
  globe: ['Глобус', 'globe'],
  plane: ['Отправка', 'send'],
  plant: ['Растение', 'sprout'],
  briefcase: ['Портфель', 'briefcase'],
  target: ['Цель', 'target'],
  linechart: ['Динамика', 'chart-line'],
  truck: ['Самосвал', 'truck'],
  toolbox: ['Инструменты', 'toolbox'],
  barrier: ['Ограждение', 'fence'],
  archive: ['Архив', 'archive'],
  inbox: ['Входящие', 'inbox'],
  stamp: ['Штамп', 'stamp'],
  pen: ['Ручка', 'pen-line'],
  calculator: ['Калькулятор', 'calculator'],
  laptop: ['Ноутбук', 'laptop'],
  phone: ['Телефон', 'phone'],
  headset: ['Гарнитура', 'headset'],
  wifi: ['Wi-Fi', 'wifi'],
  database: ['База данных', 'database'],
  server: ['Сервер', 'server'],
  cloud: ['Облако', 'cloud'],
  lock: ['Замок', 'lock'],
  flag: ['Флаг', 'flag'],
  bookmark: ['Закладка', 'bookmark'],
  filter: ['Фильтр', 'funnel'],
  share: ['Поделиться', 'share-2'],
  grid: ['Сетка', 'layout-grid'],
  gantt: ['Гант', 'chart-gantt'],
  milestone: ['Веха', 'milestone'],
  team: ['Команда', 'users'],
  badge: ['Пропуск', 'id-card'],
  bird: ['Птица', 'bird'],
  cat: ['Кот', 'cat'],
  neural: ['Нейросеть', 'brain-circuit'],
  chip: ['Чип', 'cpu-ai'],
  sparkles: ['ИИ', 'sparkles'],
  robot: ['Робот', 'bot'],
  workflow: ['Автоматизация', 'workflow'],
  bolt: ['Триггер', 'zap'],
  pipeline: ['Поток данных', 'waypoints'],
  layers: ['Слои данных', 'layers'],
  tree: ['Дерево', 'list-tree'],
  robotArm: ['Роборука', 'robot-arm'],
  plug: ['Интеграция', 'plug'],
  // Дополнительное разнообразие (13.11, «много одинаковых рядом»): формы,
  // которых не хватало — ручной инструмент, техника, связь, код и данные.
  hammer: ['Молоток', 'hammer'],
  wrench: ['Гаечный ключ', 'wrench'],
  drill: ['Дрель', 'drill'],
  pickaxe: ['Кирка', 'pickaxe'],
  shovel: ['Лопата', 'shovel'],
  forklift: ['Погрузчик', 'forklift'],
  construction: ['Стройка', 'construction'],
  container: ['Контейнер', 'container'],
  package: ['Посылка', 'package'],
  boxes: ['Коробки', 'boxes'],
  drone: ['Дрон', 'drone'],
  radioTower: ['Мачта связи', 'radio-tower'],
  antenna: ['Антенна', 'antenna'],
  satelliteDish: ['Спутниковая антенна', 'satellite-dish'],
  circuitBoard: ['Плата', 'circuit-board'],
  binary: ['Двоичный код', 'binary'],
  gitBranch: ['Ветка', 'git-branch'],
  gitFork: ['Развилка', 'git-fork'],
  gitMerge: ['Слияние', 'git-merge'],
  userCheck: ['Принят', 'user-check'],
  userCog: ['Доступ сотрудника', 'user-cog'],
  files: ['Файлы', 'files'],
  folderOpen: ['Открытая папка', 'folder-open'],
  fileSpreadsheet: ['Таблица', 'file-spreadsheet'],
  printer: ['Принтер', 'printer'],
  router: ['Роутер', 'router'],
  serverCog: ['Сервер настроек', 'server-cog'],
  mic: ['Микрофон', 'mic'],
  camera: ['Камера', 'camera'],
  video: ['Видео', 'video'],
  timer: ['Таймер', 'timer'],
  history: ['История', 'history'],
  calendarClock: ['Срок', 'calendar-clock'],
  map: ['Карта', 'map'],
  sigma: ['Сумма', 'sigma'],
  functionSquare: ['Функция', 'function-square'],
  scanLine: ['Сканирование', 'scan-line'],
};

/**
 * Логотип Nodus — знак с окна входа (`apps/web/src/app/shell/logo-icon.tsx`):
 * центральный гексагон + три балки + три точки, БЕЗ внешней рамки.
 * Нарисован вокруг (0,0): в плитке логотип ставится якорем в точку translate.
 * Штрих 1.1 с non-scaling-stroke — тонкий граф в любом масштабе.
 */
const NODUS_LOGO = `<path d="M0 -3.56 V-7.13 M-3.41 2.34 L-6.5 4.13 M3.41 2.34 L6.5 4.13" stroke-width="1.1" vector-effect="non-scaling-stroke"/><polygon points="0,-2.25 2.27,-0.94 2.27,1.69 0,3 -2.27,1.69 -2.27,-0.94" stroke-width="1.1" vector-effect="non-scaling-stroke"/><circle cx="0" cy="-8.44" r="1.7" fill="#000" stroke="none"/><circle cx="-7.63" cy="4.78" r="1.7" fill="#000" stroke="none"/><circle cx="7.63" cy="4.78" r="1.7" fill="#000" stroke="none"/>`;

module.exports = { CUSTOM, LUCIDE, NODUS_LOGO };
