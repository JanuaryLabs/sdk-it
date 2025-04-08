import { z } from 'zod';

export class ParseError<T extends z.ZodType<any, any, any>> {
  public data: z.typeToFlattenedError<T, z.ZodIssue>;
  constructor(data: z.typeToFlattenedError<T, z.ZodIssue>) {
    this.data = data;
  }
}

export function parseInput<T extends z.ZodType<any, any, any>>(
  schema: T,
  input: unknown,
) {
  const result = schema.safeParse(input);
  if (!result.success) {
    const error = result.error.flatten((issue) => issue);
    return [null, new ParseError(error)];
  }
  return [result.data as z.infer<T>, null];
}
