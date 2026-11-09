#!/usr/bin/env node
import { NxReleaseScope, commitMsg } from '@zukhruf/git-hooks';

await commitMsg([new NxReleaseScope()]);
