/** `candidate`, or `candidate` with the first number from 2 that no key of `taken` has. */
export function availableName(
  taken: Record<string, unknown>,
  candidate: string,
) {
  let name = candidate;
  let suffix = 2;
  while (taken[name]) {
    name = `${candidate}${suffix++}`;
  }
  return name;
}
