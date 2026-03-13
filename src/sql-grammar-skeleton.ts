import type { SqlErrorCode } from "./sql-errors.js";

export type SqlDialectProfile = "ansi" | "sqlite" | "postgres" | "mysql" | "sqlserver";

export type StatementKind = "select" | "union" | "other";

export type ClauseStatus = "present" | "absent";

export type UnsupportedFeature = {
  feature: string;
  code: SqlErrorCode;
  message: string;
};

export type SqlGrammarSkeleton = {
  statement: StatementKind;
  clauses: {
    cte: ClauseStatus;
    fromSubquery: ClauseStatus;
    join: ClauseStatus;
    where: ClauseStatus;
    groupBy: ClauseStatus;
    having: ClauseStatus;
    windowOver: ClauseStatus;
    setOpUnion: ClauseStatus;
    orderBy: ClauseStatus;
    limit: ClauseStatus;
    offset: ClauseStatus;
    fetch: ClauseStatus;
    top: ClauseStatus;
  };
  unsupported: UnsupportedFeature[];
};

type InspectOptions = {
  dialect?: SqlDialectProfile;
};

function collapse(sql: string): string {
  return sql.trim().replace(/\s+/g, " ");
}

function upper(sql: string): string {
  return collapse(sql).toUpperCase();
}

function startsWithWord(sqlUpper: string, word: string): boolean {
  return new RegExp(`^${word}(?:\\s|$)`, "i").test(sqlUpper);
}

function hasWord(sqlUpper: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(sqlUpper);
}

function hasFromSubquery(sqlUpper: string): boolean {
  return /\bFROM\s*\(\s*SELECT\b/i.test(sqlUpper);
}

function hasWindowOver(sqlUpper: string): boolean {
  return /\bOVER\s*\(/i.test(sqlUpper);
}

function hasTop(sqlUpper: string): boolean {
  return /\bSELECT\s+TOP\s+\d+/i.test(sqlUpper);
}

function hasFetch(sqlUpper: string): boolean {
  return /\bFETCH\s+(FIRST|NEXT)\b/i.test(sqlUpper);
}

export function inspectSqlGrammarSkeleton(sql: string, options?: InspectOptions): SqlGrammarSkeleton {
  const up = upper(sql);
  const dialect = options?.dialect ?? "ansi";

  const statement: StatementKind = hasWord(up, "UNION")
    ? "union"
    : startsWithWord(up, "SELECT") || startsWithWord(up, "WITH")
      ? "select"
      : "other";

  const clauses = {
    cte: startsWithWord(up, "WITH") ? "present" : "absent",
    fromSubquery: hasFromSubquery(up) ? "present" : "absent",
    join: hasWord(up, "JOIN") ? "present" : "absent",
    where: hasWord(up, "WHERE") ? "present" : "absent",
    groupBy: /\bGROUP\s+BY\b/i.test(up) ? "present" : "absent",
    having: hasWord(up, "HAVING") ? "present" : "absent",
    windowOver: hasWindowOver(up) ? "present" : "absent",
    setOpUnion: hasWord(up, "UNION") ? "present" : "absent",
    orderBy: /\bORDER\s+BY\b/i.test(up) ? "present" : "absent",
    limit: hasWord(up, "LIMIT") ? "present" : "absent",
    offset: hasWord(up, "OFFSET") ? "present" : "absent",
    fetch: hasFetch(up) ? "present" : "absent",
    top: hasTop(up) ? "present" : "absent",
  } as const;

  const unsupported: UnsupportedFeature[] = [];

  if (clauses.cte === "present") {
    unsupported.push({
      feature: "cte",
      code: "SQL_DIALECT_UNSUPPORTED_SYNTAX",
      message: "CTE grammar recognized but not fully enabled in baseline v1",
    });
  }

  if (clauses.fetch === "present") {
    if (dialect === "postgres" || dialect === "mysql" || dialect === "sqlserver") {
      // dialect-staged: recognized surface, parser/executor support lands in later G5 blocks
    } else {
      unsupported.push({
        feature: "fetch",
        code: "SQL_DIALECT_UNSUPPORTED_SYNTAX",
        message: "FETCH FIRST/NEXT grammar recognized but not enabled in baseline v1",
      });
    }
  }

  if (clauses.top === "present") {
    if (dialect === "sqlserver") {
      // dialect-staged: recognized surface, parser/executor support lands in later G5 blocks
    } else {
      unsupported.push({
        feature: "top",
        code: "SQL_DIALECT_UNSUPPORTED_SYNTAX",
        message: "TOP grammar recognized but not enabled in baseline v1",
      });
    }
  }

  return {
    statement,
    clauses: { ...clauses },
    unsupported,
  };
}
