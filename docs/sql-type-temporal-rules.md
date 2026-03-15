# SQL Temporal Type Rules

## A-TYPE-010: DATE
- Accepted format: `YYYY-MM-DD`.
- Validation is strict: values must round-trip to the same calendar date (invalid rollovers like `2024-04-31` are rejected).
- Leap-day behavior: leap-year dates such as `2024-02-29` are accepted; non-leap counterparts are rejected.
