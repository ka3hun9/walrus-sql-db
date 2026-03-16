# TypedValue Migration Guide

## Overview
- Runtime value paths now require `TypedValue` as the canonical transport form.
- Legacy primitive shortcuts in predicate/order/replay execution are removed.
- TypedValue regression suite is available via `npm run test:ci:typedvalue`.

## Migration Steps
1. Replace primitive direct comparisons with typed comparators:
   - `typedValueComparator.eq/lt/lte/gt/gte`
2. Replace primitive arithmetic/logical operations with:
   - `typedValueOperators.add/sub/mul/div/and/or/not`
3. Bind write values through factories:
   - `fromJs`, `fromLiteral`, `fromStorage`
4. Apply cast/implicit conversion through:
   - `convertTypedValue`
5. Use TypedValue serialization for replay/cache:
   - `serializeTypedValue` / `deserializeTypedValue`

## Verification
- Run build + full CI:
  - `npm run ci:full`
- Run TypedValue dedicated suite:
  - `npm run test:ci:typedvalue`
