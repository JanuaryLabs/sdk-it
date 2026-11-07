#!/usr/bin/env node
import { type Push, Step, prePush } from '@zukhruf/git-hooks';

class AffectedTestBuild extends Step<Push> {
  readonly name = 'test,build';

  async run(push: Push) {
    const updates = push.updates.filter((update) => update.kind !== 'delete');
    if (updates.length === 0) return this.skip('the push only deletes refs');
    const ranges: string[] = [];
    try {
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
        await push.nx(
          head,
          ...projects('test'),
          '--exclude=@sdk-it/source',
          '--outputStyle=static',
        );
        // apiref builds only with VITE_SPEC set, which CI provides.
        await push.nx(
          head,
          ...projects('build'),
          '--exclude=@sdk-it/source,@sdk-it/apiref',
          '--outputStyle=static',
        );
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return this.fail(error.message.trimEnd());
    }
    return this.pass(
      `test and build for ${ranges.join(', ')}; the @sdk-it/apiref build is left to CI`,
    );
  }
}

await prePush([new AffectedTestBuild()]);
