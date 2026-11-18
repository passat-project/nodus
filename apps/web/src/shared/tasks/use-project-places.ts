import { useProjectsList } from '../api/projects-list.js';
import type { ProjectPlaceRef } from './task-create-scope.js';

/**
 * Проекты и их типы для «где создаётся» (#665): окно создания решает по типу
 * проекта выбранного проекта, какие типы предлагать, и подставляет
 * единственный проект. Список кэшируется общим ключом — окно не платит
 * отдельным запросом.
 */
export function useProjectPlaces(): ProjectPlaceRef[] {
  const projects = useProjectsList();
  return (projects.data?.items ?? []).map((item) => ({
    id: item.id,
    typeId: item.type?.id ?? null,
  }));
}
