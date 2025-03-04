export * from './lib/deriver.ts';
export * from './lib/program.ts';
export * from './lib/paths.ts';
export * from './lib/file-system.ts';

export function removeDuplicates<T>(
  data: T[],
  accessor: (item: T) => T[keyof T],
): T[] {
  return [...new Map(data.map((x) => [accessor(x), x])).values()];
}

export type InferRecordValue<T> = T extends Record<string, infer U> ? U : any;

export function toLitObject<T extends Record<string, any>>(
  obj: T,
  accessor: (value: InferRecordValue<T>) => string = (value) => value,
) {
  return `{${Object.keys(obj)
    .map((key) => `${key}: ${accessor(obj[key])}`)
    .join(', ')}}`;
}
