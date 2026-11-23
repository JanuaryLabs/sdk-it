import type { CallExpression, Expression, Node } from '@typescript/native/ast';
import {
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
} from '@typescript/native/ast/is';
import type { Checker, Type } from '@typescript/native/sync';
import type { SchemaObject } from 'openapi3-ts/oas31';

import type { NaunceResponseAnalyzer } from '@sdk-it/core';
import { type TypeDeriver, skipParentheses } from '@sdk-it/core/deriver.js';
import type {
  FactoryErrorReader,
  ThrownMember,
  ThrownMembers,
} from '@sdk-it/core/thrown.js';

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

/**
 * The code and entry types of an evlog `DefinedError` factory that `node`
 * calls, such as `billingErrors.PAYMENT_DECLINED(...)`. The literals live in
 * the factory's type arguments, because evlog widens the factory's own
 * `status` to `number`.
 */
function catalogEntry(checker: Checker, node: Node) {
  if (!isCallExpression(node)) {
    return undefined;
  }
  const factory = checker.getTypeAtLocation(node.expression);
  if (factory.getAliasSymbol()?.name !== 'DefinedError') {
    return undefined;
  }
  const [code, entry] = factory.getAliasTypeArguments();
  if (!code?.isStringLiteralType() || !entry) {
    return undefined;
  }
  const field = (name: string) => {
    const property = checker.getPropertyOfType(entry, name);
    return property ? checker.getTypeOfSymbol(property) : undefined;
  };
  return { call: node, code, field };
}

/**
 * The catalog entry behind a thrown evlog factory call such as
 * `billingErrors.PAYMENT_DECLINED(...)`, or undefined when the call is not an
 * evlog `DefinedError`.
 */
export function catalogError(
  deriver: TypeDeriver,
  node: Node,
): CatalogError | undefined {
  const checker = deriver.checker;
  const thrown = catalogEntry(checker, node);
  if (!thrown) {
    return undefined;
  }
  const field = (name: string) => {
    const type = thrown.field(name);
    return type ? literal(type) : undefined;
  };
  const status = field('status');
  return {
    code: thrown.code.value,
    // evlog's EvlogError constructor: `this.status = opts.status ?? 500`.
    status:
      statusOverride(checker, thrown.call) ??
      (typeof status === 'number' ? status : 500),
    message: text(field('message')),
    why: text(field('why')),
    fix: text(field('fix')),
    link: text(field('link')),
  };
}

/** The members a catalog entry gives an EvlogError, and the call's options override (evlog's `buildEvlogError`). */
const overridable = ['status', 'message', 'why', 'fix', 'link'] as const;

/**
 * The members of the EvlogError a catalog factory call such as
 * `billingErrors.PAYMENT_DECLINED({ status: 409 })` throws: its `code`, and
 * each of status, message, why, fix and link as the call's options give it,
 * else as the catalog entry's literal gives it. An entry with no status binds
 * evlog's own default, `status ?? entry.status ?? 500`; a message the entry
 * builds from the call's params binds none.
 */
export class EvlogErrorMembers implements FactoryErrorReader {
  call(call: CallExpression, checker: Checker): ThrownMembers | undefined {
    const thrown = catalogEntry(checker, call);
    if (!thrown) {
      return undefined;
    }
    const members = new Map<string, ThrownMember>([
      ['code', { kind: 'type', type: thrown.code }],
    ]);
    const overrides = callOverrides(call);
    for (const name of overridable) {
      const expression = overrides.get(name);
      const type = thrown.field(name);
      if (expression) {
        members.set(name, { kind: 'expression', expression, scope: call });
      } else if (type?.isStringLiteralType() || type?.isNumberLiteralType()) {
        members.set(name, { kind: 'type', type });
      } else if (name === 'status') {
        members.set(name, { kind: 'literal', value: 500 });
      }
    }
    const cause = overrides.get('cause');
    if (cause) {
      members.set('cause', {
        kind: 'expression',
        expression: cause,
        scope: call,
      });
    }
    return members;
  }
}

function statusOverride(checker: Checker, call: CallExpression) {
  const status = callOverrides(call).get('status');
  const value = status && getConstantValue(checker, status);
  return typeof value === 'number' ? value : undefined;
}

/** Each property the factory call's options object literal gives, by name. */
function callOverrides(call: CallExpression): Map<string, Expression> {
  const overrides = new Map<string, Expression>();
  const [firstArgument] = call.arguments;
  const options = firstArgument && skipParentheses(firstArgument);
  if (!options || !isObjectLiteralExpression(options)) {
    return overrides;
  }
  for (const property of options.properties) {
    if (isPropertyAssignment(property)) {
      overrides.set(property.name.getText(), property.initializer);
    } else if (
      isShorthandPropertyAssignment(property) &&
      isIdentifier(property.name)
    ) {
      overrides.set(property.name.text, property.name);
    }
  }
  return overrides;
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
  'throw.call.EvlogError': (_scope, deriver, node) => {
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
