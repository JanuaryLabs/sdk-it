import { characterEntities } from 'character-entities';

/**
 * Decode a single character reference (without the `&` or `;`).
 * You probably only need this when you’re building parsers yourself that follow
 * different rules compared to HTML.
 * This is optimized to be tiny in browsers.
 *
 * @param value
 *   `notin` (named), `#123` (deci), `#x123` (hexa).
 * @returns
 *   Decoded reference.
 */
export function decodeNamedCharacterReference(value: string): string | false {
  return Object.hasOwn(characterEntities, value)
    ? characterEntities[value]
    : false;
}
