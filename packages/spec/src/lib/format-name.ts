const reservedWords = new Set([
  'abstract',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'deferred',
  'do',
  'dynamic',
  'else',
  'enum',
  'export',
  'extends',
  'extension',
  'external',
  'factory',
  'final',
  'finally',
  'for',
  'Function',
  'get',
  'set',
  'hide',
  'if',
  'default',
  'new',
  'implements',
  'import',
  'in',
  'interface',
  'is',
  'library',
  'mixin',
  'new',
  'null',
  'on',
  'operator',
  'part',
  'required',
  'rethrow',
  'return',
  'hide',
  'show',
]);
const STARTS_WITH_MINUS_PATTERN = /^-/;
const STARTS_WITH_DIGITS_PATTERN = /^-?\d/;
const FIRST_DASH = /^_/;
const LAST_DASH = /_$/;
const ONLY_ENGLISH = /(^\$)|(\+)|(-)|[^A-Za-z0-9]+/g;

export const formatName = (it: any): string => {
  if (reservedWords.has(it)) {
    return `$${it}`;
  }

  // 1. Handle numbers
  if (typeof it === 'number') {
    if (Math.sign(it) === -1) {
      return `$_${Math.abs(it)}`;
    }
    return `$${it}`;
  }

  // 3. Handle other strings
  if (typeof it === 'string') {
    // 3a. Check if the string starts with a digit FIRST
    if (STARTS_WITH_DIGITS_PATTERN.test(it)) {
      if (Math.sign(parseInt(it, 10)) === -1) {
        // if negative number, prefix with $_
        return `$_${Math.abs(parseInt(it, 10))}`;
      }
      // positive number or string starting with digit, prefix with $
      return `$${it}`;
    }

    return it
      .replace(ONLY_ENGLISH, (match) => {
        if (match === '-' && match === it[0]) return 'desc_';
        if (match === '+') return '_plus_';
        if (match === '$' && match === it[0]) return '$';
        return '_';
      })
      .replace(FIRST_DASH, '')
      .replace(LAST_DASH, '');
  }

  // 4. Fallback for any other types (e.g., null, undefined, objects)
  // Convert to string first, then apply snakecase
  return String(it);
};
