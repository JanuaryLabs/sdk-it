#!/usr/bin/env node
import { type Push, Step, prePush } from '@zukhruf/git-hooks';

class AffectedTestBuild extends Step<Push> {
  readonly name = 'test,build';

  async run(push: Push) {
    const updates = push.updates.filter((update) => update.kind !== 'delete');
    if (updates.length === 0) return this.skip('the push only deletes refs');
    const ranges: string[] = [];
    for (const { base, head } of updates) {
      ranges.push(
        base === undefined
          ? `every project at ${head.slice(0, 8)}`
          : `${base.slice(0, 8)}..${head.slice(0, 8)}`,
      );
      const projects = (target: string) =>
        base === undefined
          ? ['run-many', '-t', target]
          : ['affected', '-t', target, `--base=${base}`, `--head=${head}`];
      const snapshot = await push.snapshot(head, { packages: true });
      const test = await snapshot.bin('nx', [
        ...projects('test'),
        '--exclude=@sdk-it/source',
        '--outputStyle=static',
      ]);
      if (test.status !== 0)
        return this.fail(`${test.stdout}${test.stderr}`.trimEnd());
      // apiref builds only with VITE_SPEC set, which CI provides.
      const build = await snapshot.bin('nx', [
        ...projects('build'),
        '--exclude=@sdk-it/source,@sdk-it/apiref',
        '--outputStyle=static',
      ]);
      if (build.status !== 0)
        return this.fail(`${build.stdout}${build.stderr}`.trimEnd());
    }
    return this.pass(
      `test and build for ${ranges.join(', ')}; the @sdk-it/apiref build is left to CI`,
    );
  }
}

await prePush([new AffectedTestBuild()]);
