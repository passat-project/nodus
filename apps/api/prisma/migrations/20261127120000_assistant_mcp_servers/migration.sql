-- Внешние MCP-серверы ИИ-агента (#902, ADR-0043 п. 10).
--
-- Expand-миграция: только новая таблица. Первый сервер (Exa) создаётся
-- администратором на экране «Настройки → ИИ-агент → MCP», а не сидом:
-- ключ у каждого свой и шифруется на сервере.

-- CreateTable
CREATE TABLE "assistant_mcp_servers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'streamable-http',
    "api_key_ciphertext" TEXT,
    "api_key_hint" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "default_for_search" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "assistant_mcp_servers_pkey" PRIMARY KEY ("id")
);
