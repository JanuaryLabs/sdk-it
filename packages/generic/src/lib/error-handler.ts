import type {
  CallExpression,
  Expression,
  NewExpression,
  Node,
  ParameterDeclaration,
  Statement,
} from '@typescript/native/ast';
import {
  isBlock,
  isConditionalExpression,
  isIdentifier,
  isIfStatement,
  isNewExpression,
  isReturnStatement,
  isThrowStatement,
} from '@typescript/native/ast/is';
import type { Checker } from '@typescript/native/sync';

import type {
  FunctionWithBody,
  ResponseItem,
  ResponseScope,
} from '@sdk-it/core';
import { skipParentheses } from '@sdk-it/core/deriver.js';
import {
  type ThrowSite,
  ThrownBinding,
  type ThrownErrorReader,
  classChain,
} from '@sdk-it/core/thrown.js';

import { ConstructorMembers } from './constructor-members.ts';

export interface ReturnedToken {
  token: string;
  node: Expression;
}

/**
 * The tokens a statement adds, or, with `value`, the tokens an expression the
 * handler returns adds.
 */
export type TokensOf = (node: Node, value: boolean) => ReturnedToken[];

export type Respond = (
  scope: ResponseScope,
  token: string,
  node: Node,
) => ResponseItem[];

/**
 * The error a route throws, with the members its construction gives it
 * (ConstructorMembers, over the analyzer's readers), or no members when
 * nothing reads it.
 */
export function throwSite(
  thrown: NewExpression | CallExpression,
  checker: Checker,
  readers: readonly ThrownErrorReader[],
): ThrowSite {
  const type = checker.getTypeAtLocation(thrown);
  const chain = classChain(type, checker);
  const [errorClass] = chain;
  const constructed = new ConstructorMembers(readers);
  const members = isNewExpression(thrown)
    ? errorClass && constructed.construct(thrown, errorClass, checker)
    : constructed.call(thrown, checker);
  return { thrown, type, chain, members: members ?? new Map() };
}

/**
 * The app's error handler, `app.onError((error, c) => …)`. For a throw site,
 * a statement or conditional whose condition the site decides (`error
 * instanceof X`, combined with `!`, `&&` and `||`) takes its branch for the
 * site, and the statements after an `if` that the site does not enter are the
 * fallthrough. A `throw` in the handler sends nothing: Hono hands the error on
 * and the server adapter answers.
 */
export class ErrorHandler {
  readonly #handler: FunctionWithBody;
  readonly #error: ParameterDeclaration | undefined;
  readonly #context: ParameterDeclaration | undefined;
  readonly #checker: Checker;
  readonly #tokensOf: TokensOf;

  constructor(handler: FunctionWithBody, checker: Checker, tokensOf: TokensOf) {
    this.#handler = handler;
    [this.#error, this.#context] = handler.parameters;
    this.#checker = checker;
    this.#tokensOf = tokensOf;
  }

  /** What the handler sends for the error thrown at `site`. */
  responsesFor(site: ThrowSite, respond: Respond): ResponseItem[] {
    // A destructured error parameter reads no member by name.
    const binding =
      this.#error && isIdentifier(this.#error.name)
        ? new ThrownBinding(this.#error, site, this.#checker)
        : undefined;
    const scope: ResponseScope = {
      handler: this.#handler,
      context: this.#context,
      binding,
    };
    const body = this.#handler.body;
    const tokens = isBlock(body)
      ? this.#statements(body.statements, binding)
      : this.#value(body, binding);
    return tokens
      .filter(({ token }) => !token.startsWith('throw.'))
      .flatMap(({ token, node }) => respond(scope, token, node));
  }

  #value(
    expression: Expression,
    binding: ThrownBinding | undefined,
  ): ReturnedToken[] {
    const value = skipParentheses(expression);
    if (isConditionalExpression(value)) {
      const taken = binding?.decide(value.condition);
      if (taken === undefined) {
        return [
          ...this.#value(value.whenTrue, binding),
          ...this.#value(value.whenFalse, binding),
        ];
      }
      return this.#value(taken ? value.whenTrue : value.whenFalse, binding);
    }
    return this.#tokensOf(value, true);
  }

  #statements(
    statements: readonly Statement[],
    binding: ThrownBinding | undefined,
  ): ReturnedToken[] {
    const tokens: ReturnedToken[] = [];
    for (const statement of statements) {
      tokens.push(...this.#statement(statement, binding));
      if (this.#exits(statement, binding)) {
        break;
      }
    }
    return tokens;
  }

  #statement(
    statement: Statement,
    binding: ThrownBinding | undefined,
  ): ReturnedToken[] {
    if (isBlock(statement)) {
      return this.#statements(statement.statements, binding);
    }
    if (isReturnStatement(statement) && statement.expression) {
      return this.#value(statement.expression, binding);
    }
    if (isIfStatement(statement)) {
      const taken = binding?.decide(statement.expression);
      const otherwise = statement.elseStatement
        ? this.#statement(statement.elseStatement, binding)
        : [];
      if (taken === undefined) {
        return [
          ...this.#statement(statement.thenStatement, binding),
          ...otherwise,
        ];
      }
      return taken
        ? this.#statement(statement.thenStatement, binding)
        : otherwise;
    }
    return this.#tokensOf(statement, false);
  }

  /** Whether the handler leaves after `statement` for this site. */
  #exits(statement: Statement, binding: ThrownBinding | undefined): boolean {
    if (isReturnStatement(statement) || isThrowStatement(statement)) {
      return true;
    }
    if (isBlock(statement)) {
      return statement.statements.some((inner) => this.#exits(inner, binding));
    }
    if (!isIfStatement(statement)) {
      return false;
    }
    const taken = binding?.decide(statement.expression);
    const otherwise =
      statement.elseStatement !== undefined &&
      this.#exits(statement.elseStatement, binding);
    if (taken === undefined) {
      return this.#exits(statement.thenStatement, binding) && otherwise;
    }
    return taken ? this.#exits(statement.thenStatement, binding) : otherwise;
  }
}
