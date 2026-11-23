import {
  type BinaryExpression,
  type CallExpression,
  type Expression,
  type NewExpression,
  type Node,
  type ParameterDeclaration,
  SyntaxKind,
} from '@typescript/native/ast';
import {
  isBinaryExpression,
  isConditionalExpression,
  isIdentifier,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
} from '@typescript/native/ast/is';
import {
  type Checker,
  SymbolFlags,
  type Symbol as TsSymbol,
  type Type,
} from '@typescript/native/sync';

import { skipParentheses } from './deriver.js';

/**
 * What a member read gives: a type, or a literal value that a library's run
 * time sets and no type spells (evlog's and Hono's default status 500; the
 * TypeScript 7.1 checker has no factory for a number literal type).
 */
export type ThrownValue =
  | { readonly kind: 'type'; readonly type: Type }
  | { readonly kind: 'literal'; readonly value: string | number };

/**
 * What a thrown error carries in one member: the expression its throw site
 * gives the member, read in `scope` (the construction or call it is written
 * in), else its type or literal value.
 */
export type ThrownMember =
  | {
      readonly kind: 'expression';
      readonly expression: Expression;
      readonly scope: Node;
    }
  | ThrownValue;

/** The string or number literal a value is, if it is one. */
export function literalOf(value: ThrownValue): string | number | undefined {
  switch (value.kind) {
    case 'literal':
      return value.value;
    case 'type':
      return value.type.isStringLiteralType() ||
        value.type.isNumberLiteralType()
        ? value.type.value
        : undefined;
  }
}

/** Each member a thrown error carries, by name. */
export type ThrownMembers = ReadonlyMap<string, ThrownMember>;

/** Reads the members an error class gets from its construction, such as `new HTTPException(409, { message })`. */
export interface ConstructedErrorReader {
  construct(
    construction: NewExpression,
    errorClass: TsSymbol,
    checker: Checker,
  ): ThrownMembers | undefined;
}

/** Reads the members of the error a factory call returns, such as an error catalog entry. */
export interface FactoryErrorReader {
  call(call: CallExpression, checker: Checker): ThrownMembers | undefined;
}

export type ThrownErrorReader = ConstructedErrorReader | FactoryErrorReader;

/** A value a route throws: its construction, its type, its classes and its members. */
export interface ThrowSite {
  readonly thrown: Expression;
  readonly type: Type;
  /** The thrown class and each class it extends, nearest first, by the checker's base types. */
  readonly chain: readonly TsSymbol[];
  readonly members: ThrownMembers;
}

/** A class type and each class it extends, nearest first. */
export function classChain(type: Type, checker: Checker): TsSymbol[] {
  const chain: TsSymbol[] = [];
  let current: Type | undefined = type;
  while (current) {
    const symbol = current.getSymbol();
    if (!symbol || chain.some(({ id }) => id === symbol.id)) {
      break;
    }
    chain.push(symbol);
    const target: Type = current.isTypeReference()
      ? current.getTarget()
      : current;
    current = target.isClassOrInterface()
      ? checker.getBaseTypes(target)[0]
      : undefined;
  }
  return chain;
}

/** Each equality operator, and whether it holds when its operands are equal. */
const equalities = new Map<SyntaxKind, boolean>([
  [SyntaxKind.EqualsEqualsEqualsToken, true],
  [SyntaxKind.EqualsEqualsToken, true],
  [SyntaxKind.ExclamationEqualsEqualsToken, false],
  [SyntaxKind.ExclamationEqualsToken, false],
]);

/**
 * Decides a condition on the error parameter for one throw site:
 * `error instanceof X` is true when X is in the site's class chain and false
 * otherwise; an equality is decided by `equal`; `!`, `&&` and `||` combine;
 * anything else is undecided.
 */
class Narrowing {
  readonly #error: TsSymbol;
  readonly #chain: readonly TsSymbol[];
  readonly #checker: Checker;
  readonly #equal: (comparison: BinaryExpression) => boolean | undefined;

  constructor(
    error: TsSymbol,
    chain: readonly TsSymbol[],
    checker: Checker,
    equal: (comparison: BinaryExpression) => boolean | undefined,
  ) {
    this.#error = error;
    this.#chain = chain;
    this.#checker = checker;
    this.#equal = equal;
  }

  decide(condition: Expression): boolean | undefined {
    const expression = skipParentheses(condition);
    if (
      isPrefixUnaryExpression(expression) &&
      expression.operator === SyntaxKind.ExclamationToken
    ) {
      const operand = this.decide(expression.operand);
      return operand === undefined ? undefined : !operand;
    }
    if (!isBinaryExpression(expression)) {
      return undefined;
    }
    const operator = expression.operatorToken.kind;
    const equality = equalities.get(operator);
    if (equality !== undefined) {
      const equal = this.#equal(expression);
      return equal === undefined ? undefined : equal === equality;
    }
    if (operator === SyntaxKind.InstanceOfKeyword) {
      return this.#isError(expression.left)
        ? this.#inChain(expression.right)
        : undefined;
    }
    if (
      operator !== SyntaxKind.BarBarToken &&
      operator !== SyntaxKind.AmpersandAmpersandToken
    ) {
      return undefined;
    }
    const left = this.decide(expression.left);
    const right = this.decide(expression.right);
    const absorbing = operator === SyntaxKind.BarBarToken;
    if (left === absorbing || right === absorbing) {
      return absorbing;
    }
    return left === undefined || right === undefined ? undefined : !absorbing;
  }

  #isError(expression: Expression): boolean {
    const operand = skipParentheses(expression);
    return (
      isIdentifier(operand) &&
      this.#checker.getSymbolAtLocation(operand)?.id === this.#error.id
    );
  }

  #inChain(name: Expression): boolean | undefined {
    let symbol = this.#checker.getSymbolAtLocation(name);
    if (symbol && symbol.flags & SymbolFlags.Alias) {
      symbol = this.#checker.getAliasedSymbol(symbol);
    }
    if (!symbol) {
      return undefined;
    }
    return this.#chain.some(({ id }) => id === symbol.id);
  }
}

/**
 * The error an error handler reads, bound to one throw site: a read of a
 * member off the handler's error parameter (`error.status`) stands for what
 * the site gives that member, and a condition on the parameter is decided by
 * the site's classes, or, for `error.code === 'x'`, by the one literal the
 * member holds.
 */
export class ThrownBinding {
  readonly site: ThrowSite;
  readonly #parameter: ParameterDeclaration;
  readonly #error: TsSymbol;
  readonly #members: ThrownMembers;
  readonly #narrowing: Narrowing;
  readonly #checker: Checker;

  constructor(
    error: ParameterDeclaration,
    site: ThrowSite,
    checker: Checker,
    members: ThrownMembers = site.members,
  ) {
    const symbol = checker.getSymbolAtLocation(error.name);
    if (!symbol) {
      throw new Error(
        `The error handler's parameter ${error.name.getText()} has no symbol`,
      );
    }
    this.site = site;
    this.#parameter = error;
    this.#error = symbol;
    this.#members = members;
    this.#checker = checker;
    this.#narrowing = new Narrowing(symbol, site.chain, checker, (comparison) =>
      this.#equal(comparison),
    );
  }

  decide(condition: Expression): boolean | undefined {
    return this.#narrowing.decide(condition);
  }

  /** The member `node` reads off the error parameter, as `status` for `error.status`. */
  memberRead(node: Node): string | undefined {
    if (!isPropertyAccessExpression(node)) {
      return undefined;
    }
    const receiver = skipParentheses(node.expression);
    return isIdentifier(receiver) &&
      this.#checker.getSymbolAtLocation(receiver)?.id === this.#error.id
      ? node.name.text
      : undefined;
  }

  member(name: string): ThrownMember | undefined {
    return this.#members.get(name);
  }

  /** Whether `node` reads the error parameter anywhere in it. */
  readsError(node: Node): boolean {
    if (
      isIdentifier(node) &&
      this.#checker.getSymbolAtLocation(node)?.id === this.#error.id
    ) {
      return true;
    }
    let found = false;
    node.forEachChild((child) => {
      found ||= this.readsError(child);
    });
    return found;
  }

  /** What a member read gives: its bound expression's type, its bound type or literal, else its own type at the read. */
  valueOfRead(read: Expression): ThrownValue {
    const name = this.memberRead(read);
    const member = name === undefined ? undefined : this.member(name);
    if (!member) {
      return { kind: 'type', type: this.#checker.getTypeAtLocation(read) };
    }
    switch (member.kind) {
      case 'expression':
        return {
          kind: 'type',
          type: this.#checker.getTypeAtLocation(member.expression),
        };
      case 'type':
      case 'literal':
        return member;
    }
  }

  /**
   * One binding for each combination of literals that the member reads in
   * the response's `body` and `status` may hold: a member whose type is a
   * union of literals is bound to each literal in turn, so a status
   * `table[error.code]` or `error.code === 'x' ? 404 : 400` reads one key per
   * binding. Reads in a branch the site does not take are left out. A member
   * that the status sends as its value (`error.status`) never distributes: a
   * status is one literal the site gives, not each value its type allows.
   */
  distribute(
    body: Expression | undefined,
    status: Expression | undefined,
  ): ThrownBinding[] {
    const reads = new Map<string, Expression>();
    if (body) {
      this.#collectReads(body, reads);
    }
    if (status) {
      this.#collectReads(status, reads);
      for (const sent of this.#sentMembers(status)) {
        reads.delete(sent);
      }
    }
    let bindings: ThrownBinding[] = [this];
    for (const [name, read] of reads) {
      const value = this.valueOfRead(read);
      const literals =
        value.kind === 'type' && value.type.isUnionType()
          ? value.type.getTypes()
          : [];
      if (
        literals.length === 0 ||
        !literals.every((literal) => literal.isLiteralType())
      ) {
        continue;
      }
      bindings = bindings.flatMap((binding) =>
        literals.map((literal) =>
          binding.#bind(name, { kind: 'type', type: literal }),
        ),
      );
    }
    return bindings;
  }

  #bind(name: string, member: ThrownMember): ThrownBinding {
    const members = new Map(this.#members);
    members.set(name, member);
    return new ThrownBinding(
      this.#parameter,
      this.site,
      this.#checker,
      members,
    );
  }

  /** The members `expression` may be, through parentheses and each branch of a conditional the site takes. */
  #sentMembers(expression: Expression): string[] {
    const value = skipParentheses(expression);
    if (isConditionalExpression(value)) {
      const taken = this.decide(value.condition);
      if (taken === undefined) {
        return [
          ...this.#sentMembers(value.whenTrue),
          ...this.#sentMembers(value.whenFalse),
        ];
      }
      return this.#sentMembers(taken ? value.whenTrue : value.whenFalse);
    }
    const name = this.memberRead(value);
    return name === undefined ? [] : [name];
  }

  /** Whether a comparison of a member read with a value holds, when both are one literal. */
  #equal(comparison: BinaryExpression): boolean | undefined {
    const { left, right } = comparison;
    if (
      this.memberRead(skipParentheses(left)) === undefined &&
      this.memberRead(skipParentheses(right)) === undefined
    ) {
      return undefined;
    }
    const [a, b] = [left, right].map((side) =>
      literalOf(this.valueOfRead(skipParentheses(side))),
    );
    return a === undefined || b === undefined ? undefined : a === b;
  }

  #collectReads(node: Node, reads: Map<string, Expression>): void {
    if (isConditionalExpression(node)) {
      const taken = this.decide(node.condition);
      if (taken !== undefined) {
        this.#collectReads(taken ? node.whenTrue : node.whenFalse, reads);
        return;
      }
    }
    const name = this.memberRead(node);
    if (name !== undefined && isPropertyAccessExpression(node)) {
      if (!reads.has(name)) {
        reads.set(name, node);
      }
      return;
    }
    node.forEachChild((child) => this.#collectReads(child, reads));
  }
}
