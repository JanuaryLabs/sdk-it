#!/usr/bin/env node
import { type Push, Step, prePush } from '@zukhruf/git-hooks';

class AffectedTestBuild extends Step<Push> {
  readonly name = 'test,build';

  async run(push: Push) {
    const updates = push.updates.filter((update) => update.kind !== 'delete');
    if (updates.length === 0) return this.skip('the push only deletes refs');
    try {
      for (const { base, head } of updates)
        await push.nx(
          head,
          ...(base === undefined
            ? ['run-many', '-t', 'test,build']
            : [
                'affected',
                '-t',
                'test,build',
                `--base=${base}`,
                `--head=${head}`,
              ]),
          '--exclude=@sdk-it/source',
          '--outputStyle=static',
        );
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      return this.fail(error.message.trimEnd());
    }
    return this.pass();
  }
}

await prePush([new AffectedTestBuild()]);
