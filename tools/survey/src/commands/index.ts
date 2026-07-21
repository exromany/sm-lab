import type { SeedCommand } from '../define';
import { icsCommands } from './ics';
import { idvtcCommands } from './idvtc';

// Appended to by each command-family task.
export const ALL_COMMANDS: SeedCommand[] = [...icsCommands, ...idvtcCommands];
