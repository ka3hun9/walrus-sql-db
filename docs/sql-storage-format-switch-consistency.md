# MessagePack/CBOR Format Switch Consistency

## G-STOR-003
- Added replay-cache format transcoding utility:
  - `transcodeReplayCache(blob, from, to)`
- Supports safe conversion across `json`, `msgpack`, and `cbor` by round-tripping through the lossless primitive envelope.
- Guarantees logical cache equivalence after format switches.
- Covered by `test/unit-g-stor-003-format-switch-consistency.ts`.
