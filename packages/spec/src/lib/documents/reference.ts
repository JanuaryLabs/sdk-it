import { pointerTokens, valueAtPointer } from '@sdk-it/core';

/**
 * A URI reference to a value in a document, as a `$ref` or a security
 * requirement key writes it: the document's location, then `#` and a JSON
 * Pointer.
 */
export class Reference {
  /** The part before `#`, as written. Empty when the reference points into the document that holds it. */
  readonly location: string;
  /** The JSON Pointer after `#`. Empty when the reference names the whole document. */
  readonly fragment: string;

  constructor(text: string) {
    const index = text.indexOf('#');
    this.location = index === -1 ? text : text.slice(0, index);
    this.fragment = index === -1 ? '' : text.slice(index + 1);
  }

  get sameDocument() {
    return this.location === '';
  }

  /** The URL of the document the reference points into, resolved against `base`, the URI of the document that holds it. */
  documentIn(base: string | undefined) {
    if (!base && !URL.canParse(this.location)) {
      throw new Error(
        'the document declares no $self, so a relative URI has no base to resolve against',
      );
    }
    return new URL(this.location, base);
  }

  /** The value the fragment names in `document`. */
  read(document: unknown) {
    if (!this.fragment) {
      return document;
    }
    const value = valueAtPointer(document, pointerTokens(this.fragment));
    if (value === undefined) {
      throw new Error(`no value at pointer #${this.fragment}`);
    }
    return value;
  }
}
