import ts from 'typescript';

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (true) {
    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

function literalValueFromType(
  type: ts.Type,
  checker: ts.TypeChecker,
): string | number | boolean | undefined {
  if (type.isStringLiteral()) {
    return type.value;
  }
  if (type.isNumberLiteral()) {
    return type.value;
  }
  if (type.flags & ts.TypeFlags.BooleanLiteral) {
    return checker.typeToString(type) === 'true';
  }
  return undefined;
}

export function getConstantValue(
  checker: ts.TypeChecker,
  expression: ts.Expression,
): string | number | boolean | undefined {
  const unwrapped = unwrapExpression(expression);

  const constant = checker.getConstantValue(
    unwrapped as
      | ts.EnumMember
      | ts.PropertyAccessExpression
      | ts.ElementAccessExpression,
  );
  if (constant !== undefined) {
    return constant;
  }

  if (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  ) {
    return unwrapped.text;
  }
  if (ts.isNumericLiteral(unwrapped)) {
    return Number(unwrapped.text);
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }

  const type = checker.getTypeAtLocation(unwrapped);
  const literal = literalValueFromType(type, checker);
  if (literal !== undefined) {
    return literal;
  }
  if (type.isUnion()) {
    let resolved: string | number | boolean | undefined = undefined;
    for (const entry of type.types) {
      const value = literalValueFromType(entry, checker);
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
