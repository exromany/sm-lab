# TODO

- merkle have 2 modes: addresses|strikes (addresses by default)
- cli can read file with sources or plain args: `merkle addresses 0x0001 0x0002 0x0003`
- cli needs more options like `merkle --mode addresses --input 0x0001`, `merkle --mode addresses --source addresses.json`
- cli default ipfs is local started ipfs-mock
  - if PINATA_* secrets are passed - default to pinata ipfs
- readme: TS api example with `makeIcs`
