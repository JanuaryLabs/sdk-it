import type { Expression, NewExpression } from '@typescript/native/ast';
import {
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
} from '@typescript/native/ast/is';
import type {
  Checker,
  Symbol as TsSymbol,
  Type,
} from '@typescript/native/sync';

import { skipParentheses } from '@sdk-it/core/deriver.js';
import type {
  ConstructedErrorReader,
  ThrownMember,
  ThrownMembers,
} from '@sdk-it/core/thrown.js';

/** The options members HTTPException keeps: `super(options?.message, { cause: options?.cause })` and `this.res = options?.res`. */
const optionMembers = new Set(['message', 'cause', 'res']);

/**
 * The members Hono's HTTPException takes from its construction,
 * `new HTTPException(status = 500, { message, cause, res })`
 * (hono/dist/http-exception.js). Hono ships only its declaration, which has no
 * constructor body to read, so this reader holds that knowledge.
 */
export class HTTPExceptionMembers implements ConstructedErrorReader {
  construct(
    construction: NewExpression,
    errorClass: TsSymbol,
    checker: Checker,
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
      const defaulted = defaultStatus(construction, checker);
      if (defaulted) {
        members.set('status', { kind: 'type', type: defaulted });
      }
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

/** The 500 of `status = 500`, as a member of the status parameter's declared type. */
function defaultStatus(
  construction: NewExpression,
  checker: Checker,
): Type | undefined {
  const declared = checker.getContextualTypeForArgumentAtIndex(construction, 0);
  const statuses = declared?.isUnionType() ? declared.getTypes() : [];
  return statuses.find(
    (status) => status.isNumberLiteralType() && status.value === 500,
  );
}
