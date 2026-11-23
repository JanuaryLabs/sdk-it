import type { Expression } from '@typescript/native/ast';
import {
  isConditionalExpression,
  isElementAccessExpression,
  isIdentifier,
  isNumericLiteral,
  isVariableDeclaration,
} from '@typescript/native/ast/is';
import {
  type Checker,
  type Type,
  TypeFormatFlags,
} from '@typescript/native/sync';

import type { FunctionWithBody } from '@sdk-it/core';
import { nodeLocation, skipParentheses } from '@sdk-it/core/deriver.js';
import {
  type ThrownBinding,
  type ThrownValue,
  literalOf,
} from '@sdk-it/core/thrown.js';

/**
 * The status an error handler sends for one throw site. A documented status is
 * one number literal by the checker: a numeric literal, a member read the
 * site binds to one, a conditional the site decides, or a table read at a key
 * that is one literal. Any other status fails, so the host declares it
 * exactly instead of the document guessing.
 */
export class StatusResolver {
  readonly #checker: Checker;
  readonly #handler: FunctionWithBody;
  readonly #binding: ThrownBinding;

  constructor(
    checker: Checker,
    handler: FunctionWithBody,
    binding: ThrownBinding,
  ) {
    this.#checker = checker;
    this.#handler = handler;
    this.#binding = binding;
  }

  resolve(status: Expression): string {
    const value = this.#valueOf(status);
    const literal = value && literalOf(value);
    if (typeof literal === 'number') {
      return String(literal);
    }
    throw new Error(
      `app.onError at ${nodeLocation(this.#handler)} sends the error thrown at ${nodeLocation(this.#binding.site.thrown)} with the status ${status.getText()}, whose type is ${this.#text(value)}, not one number literal, so its response cannot be documented. ${this.#fix(status)}`,
    );
  }

  #text(value: ThrownValue | undefined): string {
    if (!value) {
      return 'unknown';
    }
    switch (value.kind) {
      case 'literal':
        return JSON.stringify(value.value);
      case 'type':
        return this.#checker.typeToString(
          value.type,
          undefined,
          TypeFormatFlags.NoTruncation,
        );
    }
  }

  #valueOf(status: Expression): ThrownValue | undefined {
    const expression = skipParentheses(status);
    if (isNumericLiteral(expression)) {
      return this.#typed(this.#checker.getTypeAtLocation(expression));
    }
    if (this.#binding.memberRead(expression) !== undefined) {
      return this.#binding.valueOfRead(expression);
    }
    if (isConditionalExpression(expression)) {
      const taken = this.#binding.decide(expression.condition);
      if (taken !== undefined) {
        return this.#valueOf(
          taken ? expression.whenTrue : expression.whenFalse,
        );
      }
    }
    if (isElementAccessExpression(expression)) {
      const key = this.#keyOf(expression.argumentExpression);
      if (key !== undefined) {
        return this.#typed(
          this.#checker.getTypeOfPropertyOfType(
            this.#checker.getTypeAtLocation(expression.expression),
            String(key),
          ),
        );
      }
    }
    return this.#typed(this.#checker.getTypeAtLocation(expression));
  }

  #keyOf(key: Expression): string | number | undefined {
    const value = this.#valueOf(key);
    return value && literalOf(value);
  }

  #typed(type: Type | undefined): ThrownValue | undefined {
    return type && { kind: 'type', type };
  }

  #fix(status: Expression): string {
    const name = this.#binding.memberRead(status);
    const member = name === undefined ? undefined : this.#binding.member(name);
    if (member?.kind === 'expression') {
      return `Pass a number literal as the status where the error is constructed, at ${nodeLocation(this.#binding.site.thrown)}.`;
    }
    if (name !== undefined && !member) {
      return `The error thrown at ${nodeLocation(this.#binding.site.thrown)} gives ${name} no value the analysis reads, so ${status.getText()} is only its declared type. Give the error a number literal ${name} where it is defined or thrown.`;
    }
    if (!isElementAccessExpression(status)) {
      return 'Send a number literal, or a value whose type is one number literal.';
    }
    const table = status.expression;
    const key = this.#keyOf(status.argumentExpression);
    if (key === undefined) {
      return `The key ${status.argumentExpression.getText()} has the type ${this.#text(this.#valueOf(status.argumentExpression))}, not one literal, so ${table.getText()} gives no single status. Key it by a member of the error whose type is a union of literals, or send a number literal.`;
    }
    if (
      !this.#checker.getTypeOfPropertyOfType(
        this.#checker.getTypeAtLocation(table),
        String(key),
      )
    ) {
      return `${table.getText()} has no status for the key ${JSON.stringify(key)}.`;
    }
    const declaration = isIdentifier(table)
      ? this.#checker.getSymbolAtLocation(table)?.valueDeclaration?.resolve()
      : undefined;
    const declared =
      declaration && isVariableDeclaration(declaration) && declaration.type
        ? declaration.type.getText()
        : 'Record<Key, Status>';
    // The key is one literal and the table's property for it is a widened union.
    return `Declare ${table.getText()} as const satisfies ${declared}, so each key reads its own status.`;
  }
}
