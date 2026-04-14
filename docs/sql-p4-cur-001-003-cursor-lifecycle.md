# Cursor Lifecycle

## P4-CUR-001 through P4-CUR-003

### Syntax
```sql
-- Declare a cursor
DECLARE cursor_name CURSOR FOR SELECT ... FROM ... WHERE ...;

-- Open the cursor
OPEN cursor_name;

-- Fetch rows one at a time
FETCH cursor_name INTO var1, var2;
-- or
SELECT ... FETCH cursor_name;

-- Close the cursor
CLOSE cursor_name;
```

### Cursor States
1. **Declared**: Cursor exists but not opened
2. **Open**: Cursor is active and positioned before first row
3. **EOF**: End of result set reached
4. **Closed**: Cursor deallocated, no further operations allowed

### FETCH Behavior
- Each FETCH advances to the next row
- When no more rows, returns EOF state
- After EOF, cursor remains positioned after last row

### Error Codes
- `ERR_INVALID_CURSOR_STATE` - cursor not opened when FETCH attempted
- `ERR_CURSOR_NOT_FOUND` - cursor name does not exist

## Verification
- `test/unit-p4-cur-001-003-cursor-lifecycle.ts` - cursor lifecycle tests
