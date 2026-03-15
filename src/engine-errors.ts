import {
  ClientErrorCodeEnum,
  ConstraintViolationKindEnum,
  type ClientErrorCode,
  type ConstraintViolationKind,
} from "./error/error-enums.js";

export { ClientErrorCodeEnum, ConstraintViolationKindEnum };
export type { ClientErrorCode, ConstraintViolationKind } from "./error/error-enums.js";

export type ErrorContext = {
  token?: string;
  clause?: string;
  field?: string;
};

function withContext(detail: string, context?: ErrorContext): string {
  if (!context) return detail;
  const parts: string[] = [];
  if (context.token) parts.push(`token=${context.token}`);
  if (context.clause) parts.push(`clause=${context.clause}`);
  if (context.field) parts.push(`field=${context.field}`);
  if (!parts.length) return detail;
  return `${detail} [${parts.join(", ")}]`;
}

export function sqlError(code: ClientErrorCode, detail: string, context?: ErrorContext): Error {
  return new Error(`${code}: ${withContext(detail, context)}`);
}

export function constraintError(
  kind: ConstraintViolationKind,
  detail: string,
  context?: ErrorContext,
): Error {
  return new Error(`${ClientErrorCodeEnum.ConstraintViolation}:${kind}: ${withContext(detail, context)}`);
}
