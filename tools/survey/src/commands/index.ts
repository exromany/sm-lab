import type { SeedCommand } from '../define';
import { icsCommands } from './ics';
import { idvtcCommands } from './idvtc';
import { membersCommands } from './members';

// Appended to by each command-family task.
export const ALL_COMMANDS: SeedCommand[] = [...icsCommands, ...idvtcCommands, ...membersCommands];
