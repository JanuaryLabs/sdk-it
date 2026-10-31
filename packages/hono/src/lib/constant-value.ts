import type { Expression } from '@typescript/native/ast';
import {
  isAsExpression,
  isParenthesizedExpression,
  isTypeAssertion,
} from '@typescript/native/ast/is';
import type { Checker, Type } from '@typescript/native/sync';

function unwrapExpression(node: Expression): Expression {
  let current = node;
  while (
    isAsExpression(current) ||
    isTypeAssertion(current) ||
    isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function literalValue(type: Type): string | number | boolean | undefined {
  if (
    type.isStringLiteralType() ||
    type.isNumberLiteralType() ||
    type.isBooleanLiteralType()
  ) {
    return type.value;
  }
  return undefined;
}

export function getConstantValue(
  checker: Checker,
  expression: Expression,
): string | number | boolean | undefined {
  const unwrapped = unwrapExpression(expression);

  const constant = checker.getConstantValue(unwrapped);
  if (constant !== undefined) {
    return constant;
  }

  const type = checker.getTypeAtLocation(unwrapped);
  const literal = literalValue(type);
  if (literal !== undefined) {
    return literal;
  }
  if (type.isUnionType()) {
    let resolved: string | number | boolean | undefined = undefined;
    for (const entry of type.getTypes()) {
      const value = literalValue(entry);
      if (value === undefined) {
        return undefined;
      }
      if (resolved === undefined) {
        resolved = value;
      } else if (resolved !== value) {
        return undefined;
      }
    }
    return resolved;
  }
  return undefined;
}
