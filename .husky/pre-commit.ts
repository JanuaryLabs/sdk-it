#!/usr/bin/env node
import {
  DependencyChecks,
  DockerfileInstallsFromLockfile,
  Format,
  LockfileSync,
  NoNumericPins,
  NpmrcPolicy,
  Sync,
  preCommit,
} from '@zukhruf/git-hooks';

await preCommit([
  new Sync(),
  new Format(),
  new NoNumericPins(),
  new NpmrcPolicy(),
  new LockfileSync(),
  new DockerfileInstallsFromLockfile(),
  new DependencyChecks(),
]);
