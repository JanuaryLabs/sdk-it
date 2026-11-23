import type { Expression } from '@typescript/native/ast';
import {
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSpreadAssignment,
} from '@typescript/native/ast/is';
import type { Symbol as TsSymbol } from '@typescript/native/sync';

import { skipParentheses } from '@sdk-it/core/deriver.js';
import type {
  ConstructedErrorReader,
  Construction,
  ThrownMember,
  ThrownMembers,
} from '@sdk-it/core/thrown.js';

/** The options members HTTPException keeps: `super(options?.message, { cause: options?.cause })` and `this.res = options?.res`. */
const optionMembers = new Set(['message', 'cause', 'res']);

/**
 * The members Hono's HTTPException takes from its construction,
 * `new HTTPException(status = 500, { message = '', cause, res })`
 * (hono/dist/http-exception.js). Hono ships only its declaration, which has no
 * constructor body to read, so this reader holds that knowledge.
 */
export class HTTPExceptionMembers implements ConstructedErrorReader {
  construct(
    construction: Construction,
    errorClass: TsSymbol,
  ): ThrownMembers | undefined {
    if (!isHTTPException(errorClass)) {
      return undefined;
    }
    const members = new Map<string, ThrownMember>();
    const [status, options] = construction.arguments ?? [];
    if (status) {
      members.set('status', {
        kind: 'expression',
        expression: status,
        scope: construction,
      });
    } else {
      members.set('status', { kind: 'literal', value: 500 });
    }
    const read = (name: string, expression: Expression) => {
      if (optionMembers.has(name)) {
        members.set(name, {
          kind: 'expression',
          expression,
          scope: construction,
        });
      }
    };
    const literal = options && skipParentheses(options);
    if (
      !literal ||
      (isObjectLiteralExpression(literal) &&
        !literal.properties.some(isSpreadAssignment))
    ) {
      // Error's message is '' when `options?.message` is undefined; a property below replaces it.
      members.set('message', { kind: 'literal', value: '' });
    }
    if (literal && isObjectLiteralExpression(literal)) {
      for (const property of literal.properties) {
        if (isPropertyAssignment(property)) {
          read(property.name.getText(), property.initializer);
        } else if (
          isShorthandPropertyAssignment(property) &&
          isIdentifier(property.name)
        ) {
          read(property.name.text, property.name);
        }
      }
    }
    return members;
  }
}

function isHTTPException(errorClass: TsSymbol): boolean {
  return (
    errorClass.name === 'HTTPException' &&
    errorClass.declarations.some((handle) =>
      /[\\/]hono[\\/]dist[\\/]types[\\/]http-exception\.d\.ts$/.test(
        handle.resolve()?.getSourceFile().fileName ?? '',
      ),
    )
  );
}
