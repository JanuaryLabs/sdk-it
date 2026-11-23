import {
  type CallExpression,
  type ClassLikeDeclaration,
  type ConstructorDeclaration,
  type Expression,
  type ModifierLike,
  type Node,
  NodeFlags,
  type ParameterDeclaration,
  type SignatureDeclaration,
  SyntaxKind,
} from '@typescript/native/ast';
import {
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isClassDeclaration,
  isClassExpression,
  isConstructorDeclaration,
  isExpressionStatement,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isMethodDeclaration,
  isNewExpression,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isReturnStatement,
  isShorthandPropertyAssignment,
  isSpreadElement,
  isThisExpression,
} from '@typescript/native/ast/is';
import {
  type Checker,
  SymbolFlags,
  type Symbol as TsSymbol,
} from '@typescript/native/sync';

import { skipParentheses } from '@sdk-it/core/deriver.js';
import {
  type ConstructedErrorReader,
  type Construction,
  type FactoryErrorReader,
  type ThrownErrorReader,
  type ThrownMember,
  type ThrownMembers,
  classChain,
  isSuperCall,
} from '@sdk-it/core/thrown.js';

/** A function called with arguments: the parameters an expression in its body may read. */
interface Frame {
  readonly declaration: SignatureDeclaration;
  readonly arguments: readonly Expression[];
  /** The construction or call the arguments are written in. */
  readonly call: Node;
  /** The frame the arguments are read in. */
  readonly parent: Frame | undefined;
}

/** An expression a member is bound to, with the frame whose parameters it may read. */
interface Bound {
  readonly expression: Expression;
  readonly scope: Node;
  readonly frame: Frame | undefined;
}

/**
 * The members an error gets from its construction, read from the source of
 * its class: each class of its chain sets members in its constructor
 * (`this.code = code`, `this.status = options.status`, a parameter property,
 * a field initializer), and `super(...)` constructs the base class with its
 * arguments. A parameter stands for the argument the construction gives it,
 * or its initializer when the argument is missing. ECMAScript's `Error` takes
 * its message and its `cause` option; a class that ships only its
 * declaration is read by the first reader that knows it, such as Hono's
 * HTTPException. A member assigned anything but a parameter, or a property of
 * one, is not bound.
 *
 * A thrown call that no factory reader knows is followed into the source
 * function it calls, when that function returns one construction: its
 * parameters stand for the call's arguments, so `throw conflict(409)` binds the
 * status of the `new HTTPException(status)` it returns to 409.
 */
export class ConstructorMembers
  implements ConstructedErrorReader, FactoryErrorReader
{
  readonly #readers: readonly ThrownErrorReader[];

  constructor(readers: readonly ThrownErrorReader[]) {
    this.#readers = readers;
  }

  construct(
    construction: Construction,
    _errorClass: TsSymbol,
    checker: Checker,
  ): ThrownMembers | undefined {
    return new ConstructionReading(checker, this.#readers).constructed(
      construction,
      undefined,
    );
  }

  call(call: CallExpression, checker: Checker): ThrownMembers | undefined {
    for (const reader of this.#readers) {
      const members = 'call' in reader ? reader.call(call, checker) : undefined;
      if (members) {
        return members;
      }
    }
    return new ConstructionReading(checker, this.#readers).returned(call);
  }
}

class ConstructionReading {
  readonly #checker: Checker;
  readonly #readers: readonly ThrownErrorReader[];

  constructor(checker: Checker, readers: readonly ThrownErrorReader[]) {
    this.#checker = checker;
    this.#readers = readers;
  }

  constructed(
    construction: Construction,
    frame: Frame | undefined,
  ): Map<string, ThrownMember> | undefined {
    const chain = classChain(
      this.#checker.getTypeAtLocation(construction),
      this.#checker,
    );
    return this.#classMembers(chain, 0, construction, frame);
  }

  /** The members of the one construction the source function `call` calls returns. */
  returned(call: CallExpression): Map<string, ThrownMember> | undefined {
    const declaration = this.#checker
      .getResolvedSignature(call)
      .declaration?.resolve();
    if (
      !declaration ||
      !(
        isFunctionDeclaration(declaration) ||
        isFunctionExpression(declaration) ||
        isArrowFunction(declaration) ||
        isMethodDeclaration(declaration)
      ) ||
      !declaration.body
    ) {
      return undefined;
    }
    const values = isBlock(declaration.body)
      ? returnedValues(declaration.body)
      : [declaration.body];
    const [value] = values;
    const construction = value && skipParentheses(value);
    if (
      values.length !== 1 ||
      !construction ||
      !isNewExpression(construction)
    ) {
      return undefined;
    }
    return this.constructed(construction, {
      declaration,
      arguments: call.arguments,
      call,
      parent: undefined,
    });
  }

  /**
   * The members `chain[index]` and its bases set when `construction` (a `new`
   * of the class, or the `super(...)` of the class before it) constructs it
   * with its arguments, read in `frame`.
   */
  #classMembers(
    chain: readonly TsSymbol[],
    index: number,
    construction: Construction,
    frame: Frame | undefined,
  ): Map<string, ThrownMember> | undefined {
    const errorClass = chain[index];
    if (!errorClass) {
      return undefined;
    }
    const args = construction.arguments ?? [];
    if (this.#isError(errorClass)) {
      return this.#errorMembers(args, construction, frame);
    }
    const declaration = classDeclaration(errorClass);
    if (!declaration || isAmbient(declaration)) {
      return this.#declared(construction, errorClass, frame);
    }
    const constructor = declaration.members.find(
      (member): member is ConstructorDeclaration =>
        isConstructorDeclaration(member) && !!member.body,
    );
    const own: Frame | undefined = constructor && {
      declaration: constructor,
      arguments: args,
      call: construction,
      parent: frame,
    };
    // An implicit constructor passes its arguments to `super(...args)`.
    const superCall = own
      ? constructor?.body?.statements
          .filter(isExpressionStatement)
          .map(({ expression }) => expression)
          .find(isSuperCall)
      : construction;
    const members = new Map(
      superCall &&
        this.#classMembers(chain, index + 1, superCall, own ?? frame),
    );
    for (const member of declaration.members) {
      if (
        isPropertyDeclaration(member) &&
        member.initializer &&
        !hasModifier(member.modifiers, staticKeyword)
      ) {
        // The field's own type widens a literal, so it is read by its node.
        members.set(member.name.getText(), {
          kind: 'expression',
          expression: member.initializer,
          scope: member,
        });
      }
    }
    if (!constructor || !own) {
      return members;
    }
    for (const parameter of constructor.parameters) {
      if (
        hasModifier(parameter.modifiers, parameterPropertyKeywords) &&
        isIdentifier(parameter.name)
      ) {
        this.#set(members, parameter.name.text, this.#argument(parameter, own));
      }
    }
    for (const statement of constructor.body?.statements ?? []) {
      const assigned = isExpressionStatement(statement)
        ? statement.expression
        : undefined;
      if (
        !assigned ||
        !isBinaryExpression(assigned) ||
        assigned.operatorToken.kind !== SyntaxKind.EqualsToken ||
        !isPropertyAccessExpression(assigned.left) ||
        !isThisExpression(assigned.left.expression)
      ) {
        continue;
      }
      const value = this.#parameterRead(assigned.right, own)
        ? this.#resolve(assigned.right, constructor, own)
        : undefined;
      this.#set(members, assigned.left.name.text, value);
    }
    return members;
  }

  /** A class that ships only its declaration, read by the first reader that knows it. */
  #declared(
    construction: Construction,
    errorClass: TsSymbol,
    frame: Frame | undefined,
  ): Map<string, ThrownMember> | undefined {
    for (const reader of this.#readers) {
      const read =
        'construct' in reader
          ? reader.construct(construction, errorClass, this.#checker)
          : undefined;
      if (!read) {
        continue;
      }
      const members = new Map<string, ThrownMember>();
      for (const [name, member] of read) {
        this.#set(
          members,
          name,
          member.kind === 'expression'
            ? this.#resolve(member.expression, member.scope, frame)
            : member,
        );
      }
      return members;
    }
    return undefined;
  }

  /** `new Error(message, { cause })`: its message, '' when none is given, and its cause option. */
  #errorMembers(
    args: readonly Expression[],
    construction: Construction,
    frame: Frame | undefined,
  ): Map<string, ThrownMember> {
    const members = new Map<string, ThrownMember>();
    const [message, options] = args;
    if (message) {
      this.#set(
        members,
        'message',
        this.#resolve(message, construction, frame),
      );
    } else {
      members.set('message', { kind: 'literal', value: '' });
    }
    const bound = options && this.#resolve(options, construction, frame);
    if (bound) {
      this.#set(members, 'cause', this.#property(bound, 'cause'));
    }
    return members;
  }

  #isError(errorClass: TsSymbol): boolean {
    return (
      this.#checker.resolveName('Error', SymbolFlags.Value, undefined, false)
        ?.id === errorClass.id
    );
  }

  #set(
    members: Map<string, ThrownMember>,
    name: string,
    value: Bound | ThrownMember | undefined,
  ): void {
    if (!value) {
      members.delete(name);
    } else if ('kind' in value) {
      members.set(name, value);
    } else {
      members.set(name, {
        kind: 'expression',
        expression: value.expression,
        scope: value.scope,
      });
    }
  }

  /** Whether `expression` reads a parameter of `frame`, or a property of one. */
  #parameterRead(expression: Expression, frame: Frame): boolean {
    const read = skipParentheses(expression);
    const receiver = isPropertyAccessExpression(read)
      ? skipParentheses(read.expression)
      : read;
    return this.#parameterOf(receiver, frame) !== undefined;
  }

  /** What `expression`, written in `scope`, is, through each parameter it reads in `frame`. */
  #resolve(
    expression: Expression,
    scope: Node,
    frame: Frame | undefined,
  ): Bound | undefined {
    const read = skipParentheses(expression);
    if (!frame) {
      return { expression: read, scope, frame };
    }
    const parameter = this.#parameterOf(read, frame);
    if (parameter) {
      return this.#argument(parameter, frame);
    }
    if (isPropertyAccessExpression(read)) {
      const receiver = this.#parameterOf(
        skipParentheses(read.expression),
        frame,
      );
      if (receiver) {
        const object = this.#argument(receiver, frame);
        return object && this.#property(object, read.name.text);
      }
    }
    return { expression: read, scope, frame };
  }

  /** The argument `frame` gives `parameter`, else its initializer. */
  #argument(parameter: ParameterDeclaration, frame: Frame): Bound | undefined {
    const index = frame.declaration.parameters.indexOf(parameter);
    if (
      parameter.dotDotDotToken ||
      frame.arguments.slice(0, index + 1).some(isSpreadElement)
    ) {
      return undefined;
    }
    const argument = frame.arguments[index];
    if (argument) {
      return this.#resolve(argument, frame.call, frame.parent);
    }
    return parameter.initializer
      ? this.#resolve(parameter.initializer, parameter, frame)
      : undefined;
  }

  /** The property `name` of an object literal `object` is bound to. */
  #property(object: Bound, name: string): Bound | undefined {
    const literal = skipParentheses(object.expression);
    if (!isObjectLiteralExpression(literal)) {
      return undefined;
    }
    for (const property of literal.properties) {
      if (isPropertyAssignment(property) && property.name.getText() === name) {
        return this.#resolve(property.initializer, object.scope, object.frame);
      }
      if (
        isShorthandPropertyAssignment(property) &&
        isIdentifier(property.name) &&
        property.name.text === name
      ) {
        return this.#resolve(property.name, object.scope, object.frame);
      }
    }
    return undefined;
  }

  #parameterOf(
    expression: Expression,
    frame: Frame,
  ): ParameterDeclaration | undefined {
    if (!isIdentifier(expression)) {
      return undefined;
    }
    // The name of `{ message }` is the property; its value is the variable.
    const symbol = isShorthandPropertyAssignment(expression.parent)
      ? this.#checker.getShorthandAssignmentValueSymbol(expression.parent)
      : this.#checker.getSymbolAtLocation(expression);
    const declaration = symbol?.valueDeclaration?.resolve();
    return frame.declaration.parameters.find(
      (parameter) => parameter === declaration,
    );
  }
}

function classDeclaration(
  errorClass: TsSymbol,
): ClassLikeDeclaration | undefined {
  for (const handle of errorClass.declarations) {
    const declaration = handle.resolve();
    if (
      declaration &&
      (isClassDeclaration(declaration) || isClassExpression(declaration))
    ) {
      return declaration;
    }
  }
  return undefined;
}

/** A class in a declaration file or under `declare`, whose constructor has no body to read. */
function isAmbient(declaration: ClassLikeDeclaration): boolean {
  return (
    declaration.getSourceFile().isDeclarationFile ||
    !!(declaration.flags & NodeFlags.Ambient)
  );
}

const staticKeyword = new Set([SyntaxKind.StaticKeyword]);

/** The modifiers that make a constructor parameter a property of the instance. */
const parameterPropertyKeywords = new Set([
  SyntaxKind.PublicKeyword,
  SyntaxKind.PrivateKeyword,
  SyntaxKind.ProtectedKeyword,
  SyntaxKind.ReadonlyKeyword,
  SyntaxKind.OverrideKeyword,
]);

function hasModifier(
  modifiers: readonly ModifierLike[] | undefined,
  kinds: ReadonlySet<SyntaxKind>,
): boolean {
  return modifiers?.some(({ kind }) => kinds.has(kind)) ?? false;
}

/** The values a function body returns, leaving out those of the functions nested in it. */
function returnedValues(node: Node): Expression[] {
  const values: Expression[] = [];
  node.forEachChild((child) => {
    if (isReturnStatement(child)) {
      if (child.expression) {
        values.push(child.expression);
      }
    } else if (
      !isFunctionDeclaration(child) &&
      !isFunctionExpression(child) &&
      !isArrowFunction(child) &&
      !isMethodDeclaration(child) &&
      !isClassDeclaration(child) &&
      !isClassExpression(child)
    ) {
      values.push(...returnedValues(child));
    }
  });
  return values;
}
