import { type Checker, TypeFormatFlags } from '@typescript/native/sync';

import type { ErrorResponder, ResponseItem } from '@sdk-it/core';
import { type TypeDeriver, nodeLocation } from '@sdk-it/core/deriver.js';
import {
  type ThrowSite,
  type ThrownMember,
  type ThrownValue,
  literalOf,
} from '@sdk-it/core/thrown.js';

/**
 * What Hono sends for an error when the app registers no `app.onError`
 * (hono/dist/hono-base.js `errorHandler`): an error with `getResponse`, an
 * HTTPException, is its message as text at its status, and any other error is
 * `Internal Server Error` at 500. The status follows the strict rule of an
 * error handler's: the throw site gives it as one number literal, or the
 * analysis fails.
 */
export class HonoDefaultErrorHandler implements ErrorResponder {
  responsesFor(site: ThrowSite, { checker }: TypeDeriver): ResponseItem[] {
    if (!checker.getPropertyOfType(site.type, 'getResponse')) {
      return [text('500', 'Internal Server Error')];
    }
    const message = site.members.get('message');
    const literal = message && literalOf(valueOf(message, checker));
    return [
      text(
        status(site, checker),
        typeof literal === 'string' ? literal : undefined,
      ),
    ];
  }
}

function text(statusCode: string, body: string | undefined): ResponseItem {
  return {
    contentType: 'text/plain',
    headers: [],
    statusCode,
    schema:
      body === undefined
        ? { type: 'string' }
        : { type: 'string', enum: [body] },
  };
}

function valueOf(member: ThrownMember, checker: Checker): ThrownValue {
  return member.kind === 'expression'
    ? { kind: 'type', type: checker.getTypeAtLocation(member.expression) }
    : member;
}

function status(site: ThrowSite, checker: Checker): string {
  const member = site.members.get('status');
  const value = member && valueOf(member, checker);
  const literal = value && literalOf(value);
  if (typeof literal === 'number') {
    return String(literal);
  }
  const at = nodeLocation(site.thrown);
  if (member?.kind !== 'expression') {
    throw new Error(
      `Hono's default error handler sends the HTTPException thrown at ${at} at its status, and the analysis reads no status the throw gives it. Give the error a number literal status where it is defined or thrown.`,
    );
  }
  const type = checker.getTypeAtLocation(member.expression);
  throw new Error(
    `Hono's default error handler sends the HTTPException thrown at ${at} with the status ${member.expression.getText()}, whose type is ${checker.typeToString(type, undefined, TypeFormatFlags.NoTruncation)}, not one number literal, so its response cannot be documented. Pass a number literal as the status where the error is constructed, at ${at}.`,
  );
}
