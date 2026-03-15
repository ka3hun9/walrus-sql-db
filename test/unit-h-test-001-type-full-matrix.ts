const typeSuites = [
  "./unit-a-type-001-runtime-model.ts",
  "./unit-a-type-002-smallint.ts",
  "./unit-a-type-003-int.ts",
  "./unit-a-type-004-bigint.ts",
  "./unit-a-type-005-decimal.ts",
  "./unit-a-type-006-float.ts",
  "./unit-a-type-007-double.ts",
  "./unit-a-type-008-char.ts",
  "./unit-a-type-009-varchar.ts",
  "./unit-a-type-010-date.ts",
  "./unit-a-type-011-time.ts",
  "./unit-a-type-012-timestamp.ts",
  "./unit-a-type-013-boolean.ts",
  "./unit-a-type-014-blob.ts",
  "./unit-a-type-015-null-semantics.ts",
  "./unit-a-type-016-cast-matrix.ts",
  "./unit-a-type-017-type-representation-consistency.ts",
];

for (const suite of typeSuites) {
  await import(suite);
}

console.log("ok: H-TEST-001 full type unit matrix gate");
