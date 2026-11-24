/** Подсказки о переводе в форме подразделения (#817): сотрудники, пришедшие
 *  из одного места, — одной строкой через запятую. */
export interface TransferPerson {
  name: string;
  fromName: string | null;
}

export interface TransferGroup {
  fromName: string | null;
  names: string[];
}

/** Группировка по прежнему подразделению; порядок — первого вхождения. */
export function groupTransferHints(people: readonly TransferPerson[]): TransferGroup[] {
  const groups = new Map<string | null, string[]>();
  for (const person of people) {
    const names = groups.get(person.fromName) ?? [];
    names.push(person.name);
    groups.set(person.fromName, names);
  }
  return [...groups.entries()].map(([fromName, names]) => ({ fromName, names }));
}
