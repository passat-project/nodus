-- «Файловые серверы» (#558): новое право каталога доезжает до роли admin на
-- проде (seed там не запускается, #311/#398). Сама настройка не создаётся:
-- пустой список — законное состояние «ничего не открывается», его заполняет
-- администратор в «Настройках портала».
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", 'portal.settings.manage'
FROM "roles" r
WHERE r."code" = 'admin'
ON CONFLICT ("role_id", "permission") DO NOTHING;
