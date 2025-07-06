import { tool } from 'ai';
import { z } from 'zod';

import { distillRef } from '@sdk-it/core';
import type { OurOpenAPIObject } from '@sdk-it/spec';

export function getSchemaDefinition(spec: OurOpenAPIObject) {
  return tool({
    description: 'Get the schema definition for a given reference path.',
    parameters: z.object({
      ref: z
        .string()
        .describe(
          'The complete reference path starting with a hash (e.g., "#/components/schemas/ModelName").',
        ),
    }),
    execute: async (args) => {
      console.log('Fetching schema definition for:', args.ref);
      const def = distillRef(spec, args.ref);
      if (!def) {
        return `Schema definition not found for: ${args.ref}`;
      }
      return JSON.stringify(def);
    },
  });
}
