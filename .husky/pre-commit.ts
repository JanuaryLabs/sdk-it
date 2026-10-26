#!/usr/bin/env node
import { Format, Sync, preCommit } from '@zukhruf/git-hooks';

await preCommit([new Sync(), new Format()]);
