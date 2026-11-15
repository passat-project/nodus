# Модуль chat (M6, #58)

Беседы (direct/group/project_channel/task/letter), сообщения, треды, реакции,
закрепы, прочитанность, пересылка. REST-контур под готовый контракт UI
(`packages/contracts/src/chat/chat.schemas.ts`). Realtime — WS-gateway (#104,
M13): ДОМЕННЫЕ события (все модули, #100) публикуются в Redis Stream
`nodus:domain:events` издателем `core/events/redis-stream-publisher`
(опрос outbox по монотонному `events.seq`, метка fanout_at); клиент применяет
события локально в кэш без рефеча, когда payload несёт полный DTO и
непрерывность проверяема (`message_sent`, #243 — эхо своей отправки заменяет
темп по clientMessageId), остальное — инвалидации. Модуль за фичефлагом
`chat` (I10).

Витрина беседы (#211, `vault/`; ревизия владельца 05.10 — модель Telegram):
серверные списки панели «О чате» по категориям image|video|audio|document|link
— `GET /chat/conversations/:id/attachments?type=…` (курсорная пагинация ≤100,
keyset `(seq DESC, sort_order|position ASC)`; доступ — участник, нечлен 404)
и счётчики категорий `GET …/attachments/counts` (O(1) из stats; в списке
счётчики тоже едут в каждом ответе). Классификация — `vaultKindOf`:
kind='image' → image, файлы — по mime (video/_|audio/_), остальное —
document; storage-kind вложений не меняется. `?threadRootId` — скоуп треда
(задел #42; в панели скоуп-тоггла нет — витрина всегда вся беседа). Ссылки —
write-time проекция `message_links` (извлечение `messages/link-extractor.ts`
при отправке/правке в той же транзакции, срез хвостовой пунктуации;
надгробие/бесследие чистит строки). Счётчики — денормализация
`conversation_vault_stats` (image/video/audio/document/link; стикеры НЕ
считаются), Δ-обслуживание в тех же транзакциях состава
(send/edit/delete/batch-delete/forward — `applyMessageSent/Edited/Deleted`),
statement-level upsert-инкремент по PK беседы (модель Telegram
getSearchCounters / Битрикс24: чтение O(1); row-триггеры — анти-паттерн,
Exa-research 04.10); скоуп треда считается на лету (объём треда мал).
Инвариант stats == COUNT(живых) — integration-тест (chat-vault.integration);
стартовый полный пересчёт — миграции vault_backfill и
vault_video_audio_counts (идемпотентны).
Источники «Избранного» (Ф3, реф Telegram Saved):
`GET /chat/favorites/sources` — чаты, откуда прилетали звёзды (аватар-мета,
count, MAX(favoritedAt)) и псевдоисточник «Записи» (свои живые сообщения чата
«Избранное»); только закладки бесед, где владелец участник (приватность
списка); счётчики категорий — тот же эндпоинт vault counts (единый путь).
Новый файл → событие НЕ плодим: клиент рефечит по `chat.message_*`
/ `chat.favorite_*` (WS-инвалидации).

Избранное (#171, `favorites/`; ревизия 04.10): личные закладки-ссылки на
сообщения («закладка, не копия» — контент живёт в оригинале, правки
отражаются, удаление оригинала гасит закладку у всех владельцев — каскад
#215). Таблица `favorites`
(PK user×message = идемпотентность звезды; labels JSONB — ЛИЧНЫЕ
эмодзи-метки-реакции `["🔑","📌"]`, модель Telegram Premium, НЕ справочник;
колонка note осталась исторически — контракт её не отдаёт). Эндпоинты
`/api/v1/chat/favorites`: `GET` (карточки, keyset `(created_at, message_id)`
по моменту закладки — без якоря-строки: закладку-якорь мог погасить каскад;
фильтры conversationId/label/q — label/q через RAW jsonb_path/ILIKE, т.к.
Prisma-фильтры их не выражают), `GET /labels` (DISTINCT эмодзи для чипов
поиска), `POST {messageIds 1..100}` (порядок массива = порядок цепочки в
«Избранном», createdAt=now+i; только живые сообщения бесед-участий
владельца, чужие/несуществующие/удалённые (надгробие, бесследно) молча
пропускаются; новая звезда — АКТИВНОСТЬ
«Избранного»: беседа find-or-create + touchLastMessageAt → всплывает
в списке, клиент рефечит его по favorite_added, #215; идемпотентный
повер активности не трогает), `PATCH /:messageId {labels}`
(личные метки, весь состав массивом, ≤20), `DELETE /:messageId`
(незвёздное — тихо). Приватность: выдача только карточек бесед, где
владелец ВСЁ ЕЩЁ участник (relation filter/RAW EXISTS — закладка
исключённого перестаёт выдаваться). События
`chat.favorite_added/removed/updated` — outbox в той же tx, gateway шлёт
ТОЛЬКО в user-комнату владельца (личное состояние, как прочитанность).
Карточка (favorite-card.mapper): подпись источника — title группы/канала,
имя собеседника direct; task/letter — null (фронт подставит i18n-строку).

#100: отправка несёт `urgent` («важное сообщение»: лимит
`NOTIFY_URGENT_DAILY_LIMIT`/сутки отправителя, группы ≤
`NOTIFY_URGENT_GROUP_MAX` — проверка в send-urgent.policy, I8) и снапшот
`mentionedUserIds` (упоминания — токены `@[текст](user:id)`, фиксируются
при отправке, пересчитываются правкой, #176);
payload `chat.message_sent` отдаёт оба поля модулю notifications (I3). Состав
бесед с mute-флагами читается чужими модулями через read-порт
`CHAT_MEMBERSHIP_READER` (ADR-0012, chat-ports.module); живость сообщений
(мягкое удаление, #267) — read-порт `CHAT_MESSAGE_LIVENESS` (SQL-предикат
живости для pack-time фильтра журнала уведомлений).

#177 (ревизия модели 05.10): молния — простой тоггл `urgent` (подтверждение
ознакомления выпилено решением владельца); непрочитавшим модуль notifications
повторяет пуш каждые 5 минут до часа. Остаток лимита для бейджа зарядов
молнии — `GET /chat/urgent/policy` (`urgent-policy.controller.ts` →
`UrgentPolicy`: remaining/limit/resetAt — скользящие сутки, старейшая
отправка + 24ч — и groupMax).

## Ключевые решения (почему так)

- **Порядок `seq` per-conversation**: значение выделяет `UPDATE conversations
SET last_seq = last_seq + n RETURNING` в транзакции отправки — лок строки
  сериализует вставки беседы, порядок seq == порядок коммита. Глобальный
  bigserial так не может: значение выдаётся до коммита, и курсорная выдача
  «всё после N» теряет поздно-коммитящиеся строки с меньшим seq (PostgreSQL
  docs: sequences non-transactional; подтверждено исследованием #58). Гэпы
  возможны (откат транзакции) — курсору достаточно монотонности. Порядок
  приёма параллельных POST != порядку кликов пользователя, поэтому клиент
  сериализует отправки очередью по беседе, а DTO несёт `clientMessageId`
  (= Idempotency-Key) — связка оптимистичного темпа с серверной записью
  (#243: WS-эхо заменяет темп на месте, рефечи отличают летящие отправки).
- **Идемпотентность отправки — двойная**: Redis-интерсептор (ADR-0005) +
  `UNIQUE (author_id, client_message_id)` в БД; `client_message_id` = значение
  заголовка `Idempotency-Key` (api-client ставит uuid на каждый POST),
  у копий пересылки — суффикс `:c`/`:i`. Crash-окно между реплеем и фиксацией
  закрывает БД (ON CONFLICT DO NOTHING → SELECT существующей); пересылка —
  replay блока по ключам `:c`/`:0..n` (уже зафиксированные копии отдаются
  тем же ответом без побочных эффектов; ключ в другой беседе — 409).
- **Просматриваемость — watermark (#102 раунд 2: просмотр = ВИДИМОСТЬ
  вьюпортом всей строки; раунд 3: низ строки виден = просмотрено)**:
  `conversation_members.last_read_seq` (GREATEST, не откатывается) +
  `last_read_at`. Unread = COUNT(seq > last_read_seq OR edited_at >
  last_read_at) по индексу `(conversation_id, seq)` — без денормализованных
  счётчиков. **Каналы (type=project_channel, раунд 3): бейдж = непрочитанные
  КОРНИ + непрочитанные ответы ТОЛЬКО в наблюдаемых трэдах**
  (`thread_participants.last_read_seq` — watermark трэда); прочие типы
  считают все сообщения (ответы рендерятся инлайн). Курсор двигают ТОЛЬКО
  квитанции `POST /read`; выдача ленты его не трогает; квитанция клампится
  к `conversations.last_seq`, повтор/отставшая — тихие. **«Увидел где
  угодно = просмотрено»**: квитанция из треда (`threadRootId` в теле)
  двигает watermark БЕСЕДЫ И watermark ТРЭДА наблюдателя (точка «есть
  новые» на посте). **readAt/readBy**: readAt — момент ПЕРВОГО
  просмотревшего (min; в direct он единственный); `readBy: UserRef[]` —
  просмотревшие СВОИХ сообщений (у чужих — пустой); правка исключает
  просмотревшего до пересмотра; считаются выводно из watermark-ов
  участников. **`myLastReadSeq` в conversationListItem** — якорь «открыть
  на первом непрочитанном» (seq > myLastReadSeq). `seq` в DTO — источник
  upToSeq квитанций клиента.
- **Треды — наблюдатели (раунд 3)**: уведомление и счётчик трэда — только
  наблюдателям; наблюдатель = автор поста (с первого чужого ответа) |
  ответивший (свой ответ = «видел тред до сюда»: watermark трэда доходит
  до seq ответа — прежние чужие ответы не вспыхивают непрочитанными) |
  кнопка «Следить» (toggle) | @упомянутый. @упоминания (#176): inline-токены
  `@[текст](user:uuid)` (модель Slack, грамматика/парсер —
  `@nodus/contracts` mention-tokens, один источник для api/web/моков; токен
  «Все» `@[Все](user:all)` #224 резолвится во ВСЕХ активных участников
  кроме автора — приоритет уведомления chat.mention=high поднимает обычное
  сообщение групповой беседы);
  резолвер `messages/mentions.ts` → упомянутые = АКТИВНЫЕ УЧАСТНИКИ беседы
  ∩ ≠ автор (канон Slack: не-участник и деактивированный — чип-ссылка без
  пинга; фильтр участников — listMembersPage(searchUserIds), активность —
  `USER_PROFILE_READER.filterActiveUserIds`, расширение порта ADR-0012);
  резолв ДО транзакции отправки/правки (repro chat-reliability); правка
  пересчитывает снапшот и добавляет новых упомянутых в наблюдатели.
  Дифф при правке (#239): payload `chat.message_edited` несёт
  `mentionedUserIds` (новая версия) + `previousMentionedUserIds`
  (НАКОПИТЕЛЬНОЕ `ever_mentioned_user_ids` за всю историю сообщения) —
  notifications даёт ВПЕРВЫЕ упомянутым chat.mention (high), остальным —
  прежний chat.message_edited (low); убрали-вернули того же (даже через
  правки) — не дёргается. Отправка сеет ever = снапшоту, правка пишет union;
  backfill миграции: ever = текущий снапшот. Модератор портала удаляет чужое
  только будучи УЧАСТНИКОМ беседы (модель видимости: лента читается членами).
  Пересылка (#239): упоминания СОПРОВОДИТЕЛЬНОГО комментария резолвятся
  (снапшот/наблюдатели/уведомление); копии пересланных сообщений чужие
  упоминания не пингуют (канон Telegram).
  Состояния —
  `GET /conversations/:id/threads/state` (наблюдаемые трэды + unreadCount
  чужих ответов выше watermark).
- **message_sent несёт полный DTO (раунд 3, «буря рефечей»)**: payload
  события включает собранный в транзакции отправки DTO нового сообщения
  (`toFreshDto`: вложения из claimAttachments, профили по соединению tx,
  readAt по курсорам участников — без лишних запросов) — живые клиенты
  применяют событие локально по seq (канон Telegram); дыра/правка/удаление
  — рефеч. События batch-delete/forward остаются по одному на сообщение —
  клиентский коалесцинг поглощает пачку одним окном.
- **Удаление — правило следа «по ответам» (#163, вердикт владельца 30.09)**:
  есть живые ответы (`reply_to_id`/посты треда, `deleted_at IS NULL`) →
  надгробие «Сообщение удалено» (якорь цепочки); нет — `obliterated=true`
  (бесследно) независимо от прочтений. Оба: исключение из выдач у
  obliterated, но строка/seq остаются (непрерывность курсоров, ссылки
  тредов/цитат/пинов, аудит), авто-unpin + `deleted:true` в замороженных
  цитатах ответов. **Каскад**: удаление ответа коллапсирует
  надгробие-якорь (родитель/корень треда) без оставшихся живых ответов —
  атомарное условие в UPDATE + своё событие, в той же транзакции.
  **Модерация #245**: чужое сообщение удаляют админ/владелец беседы и
  глобальный модератор портала (право `chat.moderate`, роль `moderator` в
  сиде) — только в `group`/`project_channel`; проверка в транзакции
  (`messages-delete.policy.ts`), чужое удаление — детальная аудит-запись
  `chat.message_moderated_delete` поверх route-аудита. След — тот же #163,
  второй механики нет.
  **Исключение #215**: беседа с собой («Избранное», единственный участник =
  автор) — всегда `obliterated=true` (личный чат, следов не нужно);
  удаление оригинала в ЛЮБОЙ беседе гасит строки `favorites` этого
  сообщения у всех владельцев (`deleteByMessage`, RETURNING) + событие
  `FAVORITE_REMOVED` в user-комнату каждого — карточка-призрак не висит
  в витрине надгробием; списки избранного дополнительно фильтруют
  `deleted_at IS NULL AND obliterated = false` (страховка).
- **Цитата-ответ — замороженный снапшот** (`reply_snapshot` JSONB: authorId,
  text≤160, quoteText≤160, attachmentKind): правка оригинала не меняет цитату
  (вердикт 24.09), удаление — помечает deleted (сильнее заморозки). Оригинал
  для снапшота ищется ТОЛЬКО в своей беседе (иначе утечка чужого текста);
  не найден — отправка 404 (#344: раньше `reply_to_id` на чужое сообщение
  сохранялся и маппер раскрывал автора/состояние оригинала), а при чтении
  оригинал засчитывается только из той же беседы (legacy-ссылки — как
  «исчез бесследно»). Частичная цитата (`quoteText`) обязана быть фрагментом ОТОБРАЖАЕМОГО текста оригинала (пробелы нормализуются, токены упоминаний → подписи — `canonicalQuote`; выделение через ссылку на сущность, скрытую карточкой, не засчитывается); хранится сверенная каноническая форма (без токенов и невидимых символов), несовпавшая — отбрасывается, ответ на всё сообщение (#346: раньше автор ответа мог приписать коллеге чужие слова или упоминание).
  Маппер различает исход удаления (#163): `ReplyPreview.obliterated` —
  оригинал исчез бесследно (цитата некликабельна); надгробие — цитата
  кликабельна и ведёт к пузырю «Сообщение удалено».
- **Права — роли + матрица** (`conversations.permissions` JSONB, дефолты в
  contracts): `post` ограждает только корневые сообщения ленты; ответы в
  тредах открыты всем участникам (модель канала новостей: постят избранные,
  обсуждают все). Проверки в сервисах (членство/роль — данные, не request-
  scope), нечлен → 404 (не раскрываем существование).
- **Профили участников** — read-порт `USER_PROFILE_READER` (ADR-0012): таблица
  users из чата не читается (I3/I6).
- **Канал новостей компании** — type=project_channel без привязки к проекту
  (подзаголовок «Канал»), `post=admin`, все сотрудники — участники (вердикт
  владельца 24.09.2026: новости — канал; в каналах публикация по правам, в
  группах пишут все; обсуждение в тредах открыто всем).

## Эндпоинты (`/api/v1/chat`, все за Bearer + флагом `chat`)

| Маршрут                                                             | Назначение                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /conversations`                                                | Список бесед юзера: `?cursor=&limit=&search=`; keyset `(last_activity_at DESC NULLS LAST, id)` — та же ось, что `lastActivityAt` в выдаче («Избранное» — GREATEST с последней звездой, `ACTIVITY_EXPR`); LATERAL lastMessage+unread одним запросом                                                                          |
| `GET /conversations/unread-summary`                                 | Точная сводка непрочитанных для вкладок: `{chats, entities, total}` — сумма по ВСЕМ беседам (список пагинирован, сумма страницы врёт). Предикат — общий с `unread_count` (`UNREAD_COUNT_EXPR`), hidden/snoozed исключены, треды канала учтены (#409)                                                                        |
| `POST /conversations`                                               | Группа/канал: создатель owner, memberIds (дедуп, без создателя, неизвестные отбрасываются), частичная матрица прав                                                                                                                                                                                                          |
| `POST /conversations/direct/:userId`                                | Find-or-create (вкл. «Заметки» с собой): 200 существующая / 201 созданная; 404 нет юзера; новая — только с действующим (с уволенным — лишь существующая, #343)                                                                                                                                                              |
| `PATCH /conversations/:id`                                          | Персональные pinned/muted/snoozed/hidden (hidden раскрывается активностью — `revealHidden` в send/forward, #103)                                                                                                                                                                                                            |
| `PATCH /conversations/:id/info`                                     | Переименование `{title}` (группы/каналы; право changeInfo, #186); событие conversation_updated обновляет название у всех участников                                                                                                                                                                                         |
| `POST /conversations/:id/avatar`                                    | Аватар беседы: multipart (`size` ДО файла; право changeInfo, #186) — серверная квадратизация (порт AVATAR_PROCESSOR, files: sharp WebP ≤640 по меньшей стороне) → `avatar_file_id`; событие conversation_updated                                                                                                            |
| `DELETE /conversations/:id/avatar`                                  | Убрать аватар (заглушка из инициалов; право changeInfo, #186)                                                                                                                                                                                                                                                               |
| `GET /conversations/:id/members`                                    | Участники с ролями `?cursor=&limit=&search=` (член беседы; поиск по displayName через read-порт; сортировка владелец→модераторы→участники, #186)                                                                                                                                                                            |
| `POST /conversations/:id/members`                                   | Добавить `{userIds}` (право addMembers — дефолт любой участник; только группы/каналы, #195): состоящих/неизвестных пропускает, лимит 200 точный (блокировка строки беседы FOR UPDATE + перечёт в tx, #195); событие member_added (добавленному — user-комната gateway'ем)                                                   |
| `PATCH /conversations/:id/members/:userId`                          | Роль `{role: admin\|member}` (право manageSettings — дефолт владелец; только группы/каналы, #195); роль владельца неизменна; событие member_role_changed                                                                                                                                                                    |
| `DELETE /conversations/:id/members/:userId`                         | Исключить (право removeMembers + иерархия: актёр строго старше цели; владельца нельзя; только группы/каналы, #195); черновик исключённого чистится; событие member_removed                                                                                                                                                  |
| `PUT /conversations/:id/draft`                                      | Черновик: пустой текст = удаление; revision монотонно растит сервер (LWW)                                                                                                                                                                                                                                                   |
| `GET /conversations/:id/messages`                                   | Лента ВСЕХ сообщений беседы ASC (страница — новейшие, курсор назад по seq; ответы тредов — инлайн, как в моках: прямой/групповой чат рендерит их плоско, канальный вид фильтрует корни клиентом) или тред (`?threadRootId=`: корень первым на первой странице, курсор — по старейшему ответу). Курсор просмотров НЕ двигает |
| `GET /conversations/:id/attachments`                                | Витрина беседы (#211): страница `?type=image\|video\|audio\|document\|link` (keyset seq+порядок, ≤100) + счётчики всех категорий; `?threadRootId` — скоуп треда (с корнем); участник, нечлен 404                                                                                                                            |
| `GET /conversations/:id/attachments/counts`                         | Счётчики витрины по категориям (ревизия 05.10): O(1) из денормализованных stats; `?threadRootId` — на лету; участник, нечлен 404                                                                                                                                                                                            |
| `POST /conversations/:id/read`                                      | Квитанция просмотров `{ upToSeq }` (идемпотентная): seq самой новой видимой строки вьюпорта; двигает watermark (GREATEST, кламп к last_seq) + событие `chat.message_read` только при движении (#102 р.2)                                                                                                                    |
| `POST /conversations/:id/messages`                                  | Отправка: seq+вставка+вложения+гашение черновика/snooze+события в одной tx; `attachmentRenames` (#146) — имя, выбранное в окне отправки после загрузки: применяется в claim до DTO/события, только для ids из `attachmentIds`                                                                                               |
| `PATCH .../messages/:messageId`                                     | Правка текста и состава вложений (#188): `attachmentIds` — итоговый упорядоченный список (claim новых по owner / detach убранных / reorder), `attachmentRenames` — имена файлов; только автор; editedAt при реальной смене                                                                                                  |
| `DELETE .../messages/:messageId`                                    | Есть живые ответы → 200 надгробие; нет → 204 бесследно (#163)                                                                                                                                                                                                                                                               |
| `POST .../messages/batch-delete`                                    | Свои: `{removed[], tombstones[]}`; чужие/удалённые пропускаются                                                                                                                                                                                                                                                             |
| `POST .../messages/:messageId/pin` · `DELETE .../pin` · `GET /pins` | Закрепы (идемпотентный pin, свежие первыми)                                                                                                                                                                                                                                                                                 |
| `POST .../messages/:messageId/reactions`                            | Toggle `{emoji, remove?}` → сообщение                                                                                                                                                                                                                                                                                       |
| `POST /conversations/:id/forward`                                   | Копии в эту беседу: комментарий ПЕРЕД блоком; forwardedFrom=оригинальный автор                                                                                                                                                                                                                                              |

Вложения (#57, реализовано): `POST /chat/attachments` — multipart-стрим
(поля `file`/`size`/`width`/`height`) → MinIO через порт `FILE_STORAGE`
(модуль files, ADR-0013) → строка `message_attachments` с `message_id IS
NULL`; `DELETE /chat/attachments/:id` — отмена из трея; привязка при
отправке — одноразовая (`attachmentIds`, claimAttachments). Лимиты: 100 МБ
на файл, ≤20 неотправленных (серверная сверка: fast-fail до загрузки +
перечёт под advisory-локом владельца в транзакции вставки; отказ —
объект хранилища убирается). Отдача — подписанные URL
`files/:id/content` (url в DTO; срок действия округляется до часового
бакета — URL стабилен в пределах часа, кэш браузера работает, #150).
Превью изображений (#150, ADR-0015; конвейер #221): для kind=image ≤10 МБ
(`SYNC_PREVIEW_BYTES`) миниатюра генерится СИНХРОННО в ответе загрузки —
optimistic-пузырь и получатели сразу несут лёгкое превью; тяжелее порога —
job в BullMQ (`thumbnail.queue.ts` → in-process воркер, concurrency 2).
sharp-метаданные (width/height перезаписываются серверно-авторитетно,
EXIF-поворот учтён) → WebP-дериват max-edge 800 (`FileObject.derivedFrom`
маркер деривата) → `thumb_file_id`; `thumbnailUrl` в DTO — та же подписанная
ссылка. Превью опционально: сбой/мусорный файл → null — клиент держит
заглушку и НЕ грузит оригинал в ленту (оригинал — только лайтбокс по клику);
фоновая готовность отправленного вложения привозит событие
`chat.attachment_preview_ready` ({conversationId, attachmentId,
thumbnailUrl}) — клиенты патчат плитку на месте; чтение ленты лениво
догревает сбойные miss'ы постановкой job'а. Backfill старых вложений:
`pnpm --filter @nodus/api exec tsx src/scripts/backfill-thumbnails.ts`.

Стикеры (#143, `stickers/` поддомен): паки личные/корпоративные,
дистрибуция «из чата». `GET /chat/stickers/packs` — мои (корпоративные +
свои + установленные, со стикерами целиком — пилотный объём);
`GET /packs/:id` — деталь (поповер из чата, пак может быть не в «моих»);
`POST /packs {title, scope}` (corporate — право `sticker.manage` — гейт
в сервисе: условие зависит от scope тела, декоратор маршрута не годится;
лимит 20 личных — перечёт под advisory-локом владельца); `PATCH /packs/:id` (переименовать), `DELETE /packs/:id`
(soft — «для всех»: пак исчезает из пикеров, сообщения рендерятся по
снапшоту `message_attachments.sticker_meta`; файлы не чистим — сообщения
держат те же file_id); `POST /packs/:id/stickers` — multipart (emojis
JSON-строка 1–3, size, width/height — поля ДО файла, gotcha #57):
валидация по **magic bytes** (mime клиента не верим): PNG/WebP ≤512КБ,
WebM ≤256КБ (длительность — клиентская пре-валидация; ffprobe на сервере
нет — граница скоупа); GIF/SVG — отказ `CHAT_STICKER_INVALID`; лимит 120
стикеров/пак перепроверяется в транзакции под локом строки пака; `DELETE /stickers/:id` — убрать
из пака (файл остаётся — отправленные сообщения живут);
`POST|DELETE /packs/:id/install` — «себе» (PK-идемпотентно). Стикер-
сообщение — обычный POST messages с `stickerId`: в транзакции отправки
проверка доступа (корпоративный | владеет | установлен), INSERT
вложения kind='sticker' со снапшотом пака (замораживается навсегда, как
reply-цитаты); стикер монолитен — текст/обычные вложения с ним →
VALIDATION_FAILED; черновик при stickerId НЕ гасится (keepDraft: набранный
текст живёт).
События `chat.sticker_pack_*`/`sticker_added|removed` несут `scope` и `audience` (#318):
личный пак — владелец + установившие (читаются в транзакции изменения), корпоративный —
`audience: []`, gateway шлёт всем; `sticker_pack_installed|uninstalled` — только установившему.
Право `sticker.manage` сидится роли admin (PK-идемпотентный досев в seed);
`video/webm` добавлен в INLINE_MIME отдачи файлов (проигрывание `<video>`).

Вне контура до смежных треков:
автоканалы проектов. «В задачу» — не эндпоинт чата: клиент создаёт задачу
`POST /tasks` с `sourceMessageId` (доступ к сообщению — read-порт
`CHAT_MESSAGE_ACCESS`, дедуп — в tasks).

### Чат задачи (#252, `task-chat/`)

Беседа задачи — обычная беседа `type='task'` (`conversations.task_id`,
частичный unique — арбитр гонки). Состав = участники задачи через read-порт
`TASK_CHAT_READER` (`modules/tasks/ports`): постановщик — owner, остальные —
member, наблюдатель добавляется без звука (Битрикс24) и пишет наравне с
остальными; выбывший участник теряет членство (история остаётся). Ручные
мутации состава/инфо по типу недоступны — состав ведёт задача.
Синхронизация идемпотентна: обработчики `task.created|assigned|
participants_changed` и `GET /chat/conversations/by-task/:taskId (участник задачи или её решающий — read-only, #433)`
(find-or-create при первом открытии; задача не видна или пользователь не
участник — 404). Переименование задачи (`task.updated` с `title`) —
`chat.conversation_updated`. Вкладки мессенджера — серверный фильтр
`GET /chat/conversations?scope=chats|entities` (`entities` = task + letter)
со своей курсорной пагинацией; без `scope` — всё (пикеры, гейт ленты).
Состав читается после `FOR UPDATE` беседы (гонка двух sync не возвращает
выбывшего); видящий задачу не участник (руководитель, `task.view_all`)
получает 404 без find-or-create. «Отметить как результат» принимает только
сообщения беседы самой задачи.
**Вне #252:** системные строки событий задачи (переход, ответственный,
срок) — #313: у мессенджера пока нет вида служебных сообщений.

### Чат письма (#55, `letter-chat/`)

Беседа письма — беседа `type='letter'` (`conversations.letter_id`, частичный
unique — арбитр гонки). Состав = адресат (owner) + участники
`letter_participants` через порт `LETTER_CHAT_READER` (модуль correspondence);
регистратор в чат не входит (В2). До регистрации беседы нет — roster null.
Синхронизация идемпотентна: обработчики `correspondence.letter_registered|
participants_changed|deleted` и `GET /chat/conversations/by-letter/:letterId`
(не участник — 404 без оракула); правка темы (`letter_updated` с `subject`) —
`chat.conversation_updated`. Блок `letter_transition` пишется по
`letter_stage_changed` с `recordId` и причиной (закрытие без регистрации,
отмена регистрации), текст сообщения — причина, цвет чипа — из каталога
стадий; ключ идемпотентности — `letter-transition:<event.id>`.
Счётчик `commentsCount` задачи пересчитывает модуль tasks по
`chat.message_sent|message_deleted` через `CHAT_MESSAGE_ACCESS.taskDiscussion`.
Realtime-доставка/typing/presence — WS-gateway (#104, `apps/gateway`).
TTL/автоудаление сообщений — вне продукта навсегда
(решение владельца 24.09, #96).

## Репозитории и сервисы (I5: по ответственности)

- Message: `messages.repository` (чтение: по id, лента/тред, батчи маппера),
  `messages-write.repository` (seq, идемпотентная вставка, replay-ключи,
  вложения отправки/пересылки, лимит важных), `messages-lifecycle.repository`
  (правка, надгробие/бесследно, каскад якорей), `messages-read-state.repository`
  (watermark квитанций); формы рядов и `MESSAGE_COLS` — `message-row.ts`.
- Conversation: `conversations.repository` (чтение: список, участие, состав),
  `conversations-write.repository` (find-or-create, группа, название/аватар,
  лок строки), `conversation-members.repository` (запись участия),
  `conversation-drafts.repository` (черновики).
- Витрина: `vault.repository` (чтение) / `vault-write.repository` (проекция
  ссылок + Δ stats в транзакциях состава) / `vault-kinds.ts` (классификация).
- Избранное: `favorites.repository` (закладки) / `favorite-sources.repository`
  (панель источников).
- Сервисы действий: `message-actions.service` (пересылка),
  `message-pins.service`, `message-reactions.service`, `thread-watch.service`;
  подготовка/эффекты отправки — `messages-send-prepare.ts`; DTO —
  `message-dto.mapper` + `message-attachment.dto` / `message-reply-preview` /
  `message-read-receipts`.

## События (outbox, I9; каталог — api-conventions.md, схемы — contracts)

`chat.conversation_created` · `chat.conversation_updated` (название/аватар, #186) ·
`chat.member_added` · `chat.member_removed` (#186) ·
`chat.member_role_changed` (#186) · `chat.message_sent`
(+`thread_created` первым ответом) · `chat.message_edited` ·
`chat.message_deleted` (payload.obliterated) · `chat.message_read` (upToSeq) ·
`chat.message_pinned` / `chat.message_unpinned` · `chat.reaction_added` /
`chat.reaction_removed` · `chat.attachment_updated` (мост `file.version_created`
→ беседы с вложением; подписка `events/file-version.handler.ts`, #182 — версия
подхватывается клиентами без F5). Избранное (#171):
`chat.favorite_added / removed / updated` — ТОЛЬКО user-комната владельца.
Стикеры (#143): `chat.sticker_pack_created /
_updated / _deleted` · `chat.sticker_added / _removed` ·
`chat.sticker_pack_installed / _uninstalled` (установка — событие только при
реальной вставке PK). Payload минимальный и клиентски видим (будущий
WS-fanout рассылает те же события).

## Лимиты

- Текст сообщения ≤ 4000, черновик ≤ 4000, частичная цитата ≤ 1024 (усечение
  снапшота — 160), batch/forward ≤ 100 сообщений, участников ≤ 200 (лимит точный: FOR UPDATE на строке беседы сериализует одновременные добавления, #195).
- `Idempotency-Key` отправки/пересылки — 1–128 символов (`readIdempotencyKey`,
  #243): значение транслируется участникам как `clientMessageId` DTO/WS
  (копии пересылки — суффиксы `:i`/`:c`, контракт ≤ 160); вне диапазона —
  сервер молча генерирует свой ключ.
- Избранное (#171): цепочка ≤ 100 сообщений/звёзд, метки-эмодзи ≤ 20/карточка
  (эмодзи ≤ 16); звезда идемпотентна (PK user×message).
- Пагинация ≤ 100 (дефолт 50); курсоры opaque base64url.
- Вложения (после #57): 100 МБ/файл, 20/сообщение, привязка одноразовая.
- Стикеры (#143): PNG/WebP ≤512 КБ, WebM ≤256 КБ (без звука, ≤3 с — клиентская
  пре-валидация длительности), ≤120 стикеров/пак, ≤20 личных паков, эмодзи
  1–3/стикер; magic bytes — серверная истина формата.
- Аватарки (#186): PNG/JPEG/WebP ≤10 МБ (потолок-страховка; клиентское сжатие
  — #191), сторона ≥64 (magic bytes — сервер);
  дериват — квадратный WebP по меньшей стороне (≤640), устанавливаются на
  беседу (группы/каналы, право changeInfo) и свой профиль (directory).

## Тесты

- Unit: permissions, reply-snapshot, computeReadAt, cursor.util, сервисы
  (моки репозиториев), стикеры (magic bytes, лимиты, права — stickers/*.test).
- Integration (живые PG/Redis, `test:integration`): контракты всех маршрутов,
  гонки (параллельный дубль отправки → 1 строка; 20 параллельных вставок →
  seq 1..20 без дыр; find-or-create race → 1 беседа), пагинация без
  потерь, outbox-атомарность, unread/readAt циклы, стикеры сквозной
  (create→upload→send→install→send→soft-delete, chat-stickers.integration).

#212 Превью ссылок (`link-previews/`, ADR-0018): асинхронный конвейер —
сообщение летит мгновенно, карточка дозревает фоном. Слушатель
`chat.message_sent/edited` (`message-links.handler.ts`) берёт готовую
проекцию `message_links` → URL без кэша → BullMQ `chat-link-preview`
(jobId = нормализованный URL, дедуп; транзакцию отправки не трогаем).
Воркер `link-preview.worker.ts` → `link-preview.service.ts`: наши
SSRF-гварды (схема, порт 80/443/дефолт, без кредов; self-домены —
карточка без фетча) + linkpeek (приватные диапазоны, ручные редиректы с
ревалидацией, 30 КБ, 8с) + per-user лимит ~30 фетчей/час
(`link-preview.rate-limiter.ts`); og:image → sharp-дериват ≤640px webp в
SILO (без хотлинков); кэш `link_previews` (нормализованный URL —
`url-normalize.ts`, общий для ключа и обогащения): ready 24ч / failed 1ч
(заглушка из домена, главный режим отказа I11) / blocked бессрочно.
Готовность — событие `chat.link_preview_ready` (комната беседы; payload
несёт DTO-снимок). Чтение: DTO сообщения `linkPreview` ПЕРВОЙ ссылки
(батч-кэш в `message-dto.mapper.ts`; toFreshDto — null, скелетон на
клиенте), витрина `GET ?type=link` — `preview` в элементах (батч).
Ленивый прогрев: только новые события, бэкфилла нет.

## Вид сообщения и блок перехода (#380)

`messages.kind` (`text | task_transition`; #313 добавит `system`) + `payload JSONB`. Обработчик `task.stage_changed` с `recordId` и непустой причиной/итогом пишет в беседу задачи сообщение `kind='task_transition'`: автор — нажавший, `text` — причина (поиск/цитаты/превью уведомлений работают по тексту), `payload` — `TaskTransitionBlock` (кнопка, статусы, подпись, счётчики файлов/сообщений). Идемпотентность — `client_message_id = task-transition:<event.id>` в существующем unique `(author_id, client_message_id)`; повтор доставки outbox блок не дублирует. Правка блока — 403 (журнал и чат не расходятся), удаление — по общим правилам.

`GET /chat/conversations/:id/messages/lookup?ids=` — живые сообщения беседы по id (≤50, только участник, иначе 404): окну перехода нужны файлы/сообщения итога вне загруженной ленты. Read-порт `CHAT_MESSAGE_ACCESS` получил `attachmentCount`, батч `taskMessages` (один SQL с членством и `task_id`) и `countAttachments` (факт задачи, без проверки зрителя); методы принимают `tx`, чтобы чтение шло клиентом транзакции (gotcha realtime).
