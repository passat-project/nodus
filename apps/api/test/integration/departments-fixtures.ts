import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';

/**
 * Корень управленческой структуры один — главная карточка компании (#982,
 * #1028). Интеграционные наборы исторически создавали каждый узел корнем;
 * после серверного инварианта второй корень — `409`. Рабочие узлы тестов
 * вешаем на существующую компанию, а если её нет — создаём один раз.
 */
export type DirectoryApi = (
  user: { token: string },
  method: string,
  path: string,
  options?: { body?: unknown; key?: string },
) => Promise<Response>;

let companyRootId: string | null = null;

export async function managementParentId(
  api: DirectoryApi,
  user: { token: string },
): Promise<string> {
  if (companyRootId !== null) return companyRootId;

  const roots = async (): Promise<string | null> => {
    const response = await api(user, 'GET', '/directory/departments/tree?kind=management');
    expect(response.status).toBe(200);
    const nodes = (await response.json()) as { id: string }[];
    return nodes[0]?.id ?? null;
  };

  let id = await roots();
  if (id === null) {
    const response = await api(user, 'POST', '/directory/departments', {
      body: { name: `Компания ${randomUUID().slice(0, 8)}`, kind: 'management', parentId: null },
      key: randomUUID(),
    });
    // Параллельный набор мог создать корень первым — берём его.
    if (response.status === 409) id = await roots();
    else {
      expect(response.status).toBe(201);
      id = ((await response.json()) as { id: string }).id;
    }
  }

  companyRootId = id;
  if (companyRootId === null) throw new Error('Management root is not available');
  return companyRootId;
}
