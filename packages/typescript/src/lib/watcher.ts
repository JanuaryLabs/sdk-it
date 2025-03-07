import { watch as nodeWatch } from 'node:fs/promises';
import { debounceTime, from } from 'rxjs';

export function watch(path: string) {
  return from(
    nodeWatch(path, {
      persistent: true,
      recursive: true,
    }),
  ).pipe(debounceTime(400));
}
