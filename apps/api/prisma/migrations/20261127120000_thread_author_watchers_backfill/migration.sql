-- #1072: авторы корневых постов каналов — наблюдатели своих тредов.
-- Рантим теперь создаёт строку участия при публикации поста; бэкфилл
-- закрывает существующие посты. Тихо: watermark = самому свежему живому
-- ответу треда (нет ответов — seq поста), чтобы история не вспыхнула
-- «непрочитанным» у всех авторов разом.
INSERT INTO "thread_participants" ("thread_root_id", "user_id", "source", "last_read_seq")
SELECT m.id,
       m.author_id,
       'author',
       COALESCE(
         (SELECT MAX(r.seq) FROM messages r
          WHERE r.thread_root_id = m.id AND r.deleted_at IS NULL),
         m.seq
       )
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
WHERE c.type = 'project_channel'
  AND m.thread_root_id IS NULL
  AND m.deleted_at IS NULL
ON CONFLICT DO NOTHING;
