export class SqlFunctionError extends Error {
  constructor(fnName: string, message: string) {
    super(`${fnName}(): ${message}`);
    this.name = "SqlFunctionError";
  }
}

export function functionError(fnName: string, message: string): Error {
  return new SqlFunctionError(fnName, message);
}

export function functionArityError(fnName: string, min: number, max: number, got: number): Error {
  const maxStr = max === -1 ? "unlimited" : String(max);
  return functionError(
    fnName,
    `requires ${min == max ? String(min) : `at least ${min} and at most ${max}`} argument(s), got ${got}`
  );
}

export function functionTypeError(fnName: string, argIndex: number, expected: string, got: string): Error {
  return functionError(
    fnName,
    `argument ${argIndex + 1} expects ${expected}, got ${got}`
  );
}

export function functionValueError(fnName: string, message: string): Error {
  return functionError(fnName, message);
}
