import { libConfig } from '@sm-lab/config/tsdown';

// Data package: a single library entry, dual ESM+CJS so external consumers
// (SDK/widget) can require it too. No bin. Generated src/abi/* is bundled in.
export default libConfig();
