import { z } from 'zod';

export class ParseError<T extends z.ZodType<any, any, any>> extends Error {
  public data: z.typeToFlattenedError<T, z.ZodIssue>;
  constructor(data: z.typeToFlattenedError<T, z.ZodIssue>) {
    super('Validation failed');
    this.name = 'ParseError';
    this.data = data;
  }
}

export function parseInput<T extends z.ZodType<any, any, any>>(
  schema: T,
  input: unknown,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const error = result.error.flatten((issue) => issue);
    throw new ParseError(error);
  }
  return result.data as z.infer<T>;
}
