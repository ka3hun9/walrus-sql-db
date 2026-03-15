# Storage Lossless Serialization Strategy

## G-STOR-001
- Replay-cache persistence now uses a typed envelope (`sql-primitive-v1`) for row cells.
- Each primitive is encoded with an explicit kind (`null|boolean|number|string`) before JSON/MessagePack/CBOR serialization.
- Numeric cells are persisted as decimal text to avoid codec-dependent precision drift.
- Deserialization remains backward-compatible with legacy plain snapshots.
- Covered by `test/unit-g-stor-001-lossless-serialization.ts`.
