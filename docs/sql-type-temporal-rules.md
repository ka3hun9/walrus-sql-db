# SQL Temporal Type Rules

## A-TYPE-010: DATE
- Accepted format: `YYYY-MM-DD`.
- Validation is strict: values must round-trip to the same calendar date (invalid rollovers like `2024-04-31` are rejected).
- Leap-day behavior: leap-year dates such as `2024-02-29` are accepted; non-leap counterparts are rejected.

## A-TYPE-011: TIME
- Accepted format: `HH:MM:SS` (24-hour clock).
- Validation is strict: `HH` must be `00..23`, `MM` must be `00..59`, and `SS` must be `00..59`.
- Inputs with invalid ranges or shape (for example `24:00:00` or `1:2:3`) are rejected.
