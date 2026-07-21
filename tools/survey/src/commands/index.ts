import type { SeedCommand } from '../define';
import { filesCommands } from './files';
import { icsCommands } from './ics';
import { idvtcCommands } from './idvtc';
import { resetCommand } from './maintenance';
import { membersCommands } from './members';
import { rotationCommands } from './rotation';

// Appended to by each command-family task.
export const ALL_COMMANDS: SeedCommand[] = [
  ...icsCommands,
  ...idvtcCommands,
  ...membersCommands,
  ...rotationCommands,
  ...filesCommands,
  resetCommand,
];
