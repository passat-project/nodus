-- #922: текст вложений PDF/DOCX для ИИ-агента — кэш по версии файла.
CREATE TABLE "file_text_extracts" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "pages" JSONB NOT NULL,
    "total_pages" INTEGER,
    "chars" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "scanned_pages" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "file_text_extracts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "file_text_extracts_file_id_key" ON "file_text_extracts"("file_id");

ALTER TABLE "file_text_extracts" ADD CONSTRAINT "file_text_extracts_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
