import type { SeedCommand } from '../define';
import { icsCommands } from './ics';

// Appended to by each command-family task.
export const ALL_COMMANDS: SeedCommand[] = [...icsCommands];
