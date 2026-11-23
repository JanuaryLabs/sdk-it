import type { CallExpression, Expression } from '@typescript/native/ast';
import {
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
} from '@typescript/native/ast/is';
import type { Checker } from '@typescript/native/sync';

import { skipParentheses } from '@sdk-it/core/deriver.js';
import type {
  FactoryErrorReader,
  ThrownMember,
  ThrownMembers,
} from '@sdk-it/core/thrown.js';

/**
 * The code and entry types of the evlog `DefinedError` factory that `node`
 * calls, such as `billingErrors.PAYMENT_DECLINED(...)`. The literals live in
 * the factory's type arguments, because evlog widens the factory's own
 * `status` to `number`.
 */
function catalogEntry(checker: Checker, node: CallExpression) {
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
  return { code, field };
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
