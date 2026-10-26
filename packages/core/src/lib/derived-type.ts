// Kept apart from deriver.ts so reading derived types never loads the TypeScript compiler.
export const deriveSymbol = Symbol.for('serialize');
export const $types = Symbol.for('types');
