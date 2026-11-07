/**
 * The client name code samples use: the spec title's letter and digit words in
 * PascalCase ('Discord HTTP API (Preview)' gives DiscordHttpApiPreview). A word
 * in capitals is lowercased after its first letter; any other word keeps its
 * capitals ('OpenStatus'). A name that would start with a digit gets the prefix
 * Api ('2024 Events' gives Api2024Events).
 */
export function titleClientName(title: string | undefined): string {
  if (!title?.trim()) {
    throw new Error(
      'The spec has no info.title, which OpenAPI requires. The API reference names the client in its code samples after it.',
    );
  }
  const name = (title.match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((word) =>
      word === word.toUpperCase()
        ? `${word[0]}${word.slice(1).toLowerCase()}`
        : `${word[0].toUpperCase()}${word.slice(1)}`,
    )
    .join('');
  return /^\p{N}/u.test(name) ? `Api${name}` : name;
}
