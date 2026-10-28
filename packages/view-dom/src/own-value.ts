export function ownValue<T>(
  record: Readonly<Record<string, T>> | null | undefined,
  key: string,
): T | undefined {
  if (record === null || record === undefined) {
    return undefined;
  }
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
