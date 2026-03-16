# DDL In Transaction Policy

## P2-TXN-006
- Runtime policy is now `forbid`: DDL statements (`CREATE`, `ALTER`, `DROP`) are rejected while session transaction state is `active`.
- Rejection is explicit: `ERR_UNSUPPORTED_DDL` with message suffix `policy=forbid_ddl_in_tx`.
- Behavior is deterministic across transaction paths:
  - `BEGIN` enters `active`.
  - DDL in `active` errors and transitions transaction state to `aborted`.
  - `COMMIT` from `aborted` remains rejected by `ERR_TRANSACTION_STATE`.
  - `ROLLBACK` from `aborted` returns to `idle` and clears staged state.
- DDL remains allowed when transaction state is `idle`.
