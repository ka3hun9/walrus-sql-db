# FK ON UPDATE CASCADE / RESTRICT

## P2-FK-006
- Parent-row update now enforces FK `ON UPDATE` actions when referenced key columns change.
- `ON UPDATE RESTRICT` and `ON UPDATE NO ACTION` block parent-key updates if child references exist.
- `ON UPDATE CASCADE` rewrites child FK columns to the new parent key value.
- Cascaded child updates run through the normal row-update path (schema checks + indexes + logs).
- `UPDATE` statement `affectedRows` includes direct parent updates + cascaded child updates.
- Coverage: `test/unit-f-fk-006-on-update-cascade-restrict.ts`.
