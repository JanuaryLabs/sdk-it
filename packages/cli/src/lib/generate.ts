import { Command } from 'commander';

import typescript from './langs/typescript';

export default new Command('generate').addCommand(typescript);
