-- #250, security-ревью: миграция 160000 красила ЛЮБОЙ video/* в kind='video',
-- включая WebM-стикеры (kind='sticker' с mime video/webm). Стикер переставал
-- рисоваться глифом, появлялся в витрине «Видео» и попадал в конвейер ffmpeg.
-- Возвращаем стикеры на место по снапшоту пака (sticker_meta пишется только
-- стикерам). Идемпотентно: строк без снапшота не трогает.
UPDATE "message_attachments"
SET "kind" = 'sticker'
WHERE "kind" = 'video' AND "sticker_meta" IS NOT NULL;
