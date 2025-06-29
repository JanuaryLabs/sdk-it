/**
 * Set of reserved TypeScript keywords and common verbs potentially used as tags.
 */
export const reservedKeywords = new Set([
  'await', // Reserved in async functions
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements', // Strict mode
  'import',
  'in',
  'instanceof',
  'interface', // Strict mode
  'let', // Strict mode
  'new',
  'null',
  'package', // Strict mode
  'private', // Strict mode
  'protected', // Strict mode
  'public', // Strict mode
  'return',
  'static', // Strict mode
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield', // Strict mode / Generator functions
  // 'arguments' is not technically a reserved word, but it's a special identifier within functions
  // and assigning to it or declaring it can cause issues or unexpected behavior.
  'arguments',
]);

export const reservedSdkKeywords = new Set([
  'ClientError',
  'Error',
  'ConflictError',
]);
