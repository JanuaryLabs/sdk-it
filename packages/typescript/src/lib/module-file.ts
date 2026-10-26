import { spinalcase } from 'stringcase';

/**
 * The file name (without extension) of a generated module. A module named
 * `index` would collide with its folder's barrel, so it gets a trailing `-`,
 * the way spinalcase renders the namer's trailing `_`.
 */
export function moduleFileName(name: string) {
  const file = spinalcase(name);
  return file === 'index' ? 'index-' : file;
}
