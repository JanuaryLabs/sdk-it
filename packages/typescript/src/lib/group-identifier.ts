import { camelcase } from 'stringcase';

import { sanitizeTag } from '@sdk-it/spec';

/**
 * The identifier a group (operation tag) gets in generated code. camelcase
 * drops the leading `_` that keeps a digit-leading tag like `_2fa` a valid
 * identifier, so the tag is sanitized again afterwards.
 */
export function groupIdentifier(group: string) {
  return sanitizeTag(camelcase(group));
}
