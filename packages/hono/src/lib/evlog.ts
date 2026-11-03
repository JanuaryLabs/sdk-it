import type { CallExpression, Node } from '@typescript/native/ast';
import {
  isCallExpression,
  isObjectLiteralExpression,
  isPropertyAssignment,
} from '@typescript/native/ast/is';
import type { Checker, Type } from '@typescript/native/sync';
import type { SchemaObject } from 'openapi3-ts/oas31';

import type { NaunceResponseAnalyzer } from '@sdk-it/core';
import type { TypeDeriver } from '@sdk-it/core/deriver.js';

import { getConstantValue } from './constant-value.js';

/** What an evlog error catalog entry tells a client about the error a factory throws. */
export interface CatalogError {
  code: string;
  status: number;
  /** Undefined when the entry builds its message from call-site params. */
  message: string | undefined;
  why: string | undefined;
  fix: string | undefined;
  link: string | undefined;
}

function literal(type: Type): unknown {
  return 'value' in type ? type.value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function statusOverride(checker: Checker, call: CallExpression) {
  const [options] = call.arguments;
  if (!options || !isObjectLiteralExpression(options)) {
    return undefined;
  }
  for (const property of options.properties) {
    if (
      isPropertyAssignment(property) &&
      property.name.getText() === 'status'
    ) {
      const status = getConstantValue(checker, property.initializer);
      return typeof status === 'number' ? status : undefined;
    }
  }
  return undefined;
}

/**
 * The catalog entry behind a thrown evlog factory call such as
 * `billingErrors.PAYMENT_DECLINED(...)`, or undefined when the call is not an
 * evlog `DefinedError`. The literals live in the factory's type arguments,
 * because evlog widens the factory's own `status` to `number`.
 */
export function catalogError(
  deriver: TypeDeriver,
  node: Node,
): CatalogError | undefined {
  if (!isCallExpression(node)) {
    return undefined;
  }
  const checker = deriver.checker;
  const factory = checker.getTypeAtLocation(node.expression);
  if (factory.getAliasSymbol()?.name !== 'DefinedError') {
    return undefined;
  }
  const [codeType, entry] = factory.getAliasTypeArguments();
  const code = literal(codeType);
  if (typeof code !== 'string') {
    return undefined;
  }
  const field = (name: string) => {
    const property = checker.getPropertyOfType(entry, name);
    return property ? literal(checker.getTypeOfSymbol(property)) : undefined;
  };
  const status = field('status');
  return {
    code,
    // evlog's EvlogError constructor: `this.status = opts.status ?? 500`.
    status:
      statusOverride(checker, node) ??
      (typeof status === 'number' ? status : 500),
    message: text(field('message')),
    why: text(field('why')),
    fix: text(field('fix')),
    link: text(field('link')),
  };
}

/** The JSON evlog writes for an `EvlogError` (`EvlogError#toJSON`). */
function evlogErrorBody(error: CatalogError): SchemaObject {
  const string: SchemaObject = { type: 'string' };
  return {
    type: 'object',
    required: ['name', 'message', 'status', 'data'],
    properties: {
      name: { type: 'string', enum: ['EvlogError'] },
      message: string,
      status: { type: 'number', enum: [error.status] },
      data: {
        type: 'object',
        required: ['code'],
        properties: {
          code: { type: 'string', enum: [error.code] },
          why: string,
          fix: string,
          link: string,
        },
      },
      cause: {
        type: 'object',
        required: ['name', 'message'],
        properties: { name: string, message: string },
      },
    },
  };
}

/**
 * Documents `throw catalog.KEY(...)` from an evlog `defineErrorCatalog` with
 * evlog's own JSON body, for apps whose error handler returns the error as is.
 * Spread it beside `responseAnalyzer`; for another body, write a
 * `throw.call.EvlogError` entry with {@link catalogError}.
 */
export const evlogErrors: NaunceResponseAnalyzer = {
  'throw.call.EvlogError': (_handler, deriver, node) => {
    const error = catalogError(deriver, node);
    if (!error) {
      return [];
    }
    return [
      {
        statusCode: String(error.status),
        contentType: 'application/json',
        headers: [],
        schema: evlogErrorBody(error),
      },
    ];
  },
};
