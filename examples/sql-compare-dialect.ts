export type SqliteMapKind = "SOME_GT" | "ALL_GT_NULLSAFE" | "DERIVED_ALIAS_DOT" | "ROW_NUMBER_DERIVED";

export function mapSqliteSql(
  walrusSql: string,
  sqliteSql?: string,
  sqliteMap?: SqliteMapKind,
): string {
  if (sqliteSql) return sqliteSql;
  if (!sqliteMap) return walrusSql;

  if (sqliteMap === "SOME_GT") {
    return walrusSql.replace(
      />\s*SOME\s*\(\s*SELECT\s+(.+?)\s+FROM\s+(.+?)\s*\)/i,
      "> (SELECT MIN($1) FROM $2)",
    );
  }

  if (sqliteMap === "ALL_GT_NULLSAFE") {
    const m = walrusSql.match(/^SELECT\s+(.+?)\s+FROM\s+(.+?)\s+WHERE\s+(.+?)\s*>\s*ALL\s*\(\s*SELECT\s+(.+?)\s+FROM\s+(.+?)\s*\)\s+ORDER BY\s+(.+)$/i);
    if (m) {
      const sel = m[1]!;
      const from = m[2]!;
      const left = m[3]!;
      const innerCol = m[4]!;
      const innerFrom = m[5]!;
      const ord = m[6]!;
      return `SELECT ${sel} FROM ${from} WHERE (SELECT COUNT(*) FROM ${innerFrom}) = 0 OR ((SELECT COUNT(*) FROM ${innerFrom} WHERE ${innerCol} IS NULL) = 0 AND ${left} > (SELECT MAX(${innerCol}) FROM ${innerFrom} WHERE ${innerCol} IS NOT NULL)) ORDER BY ${ord}`;
    }
  }

  if (sqliteMap === "DERIVED_ALIAS_DOT") {
    return walrusSql.replace(/^SELECT\s+([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s+/i, 'SELECT $1.$2 AS "$1.$2" ');
  }

  if (sqliteMap === "ROW_NUMBER_DERIVED") {
    return walrusSql.replace(
      /^SELECT\s+(.+?)\s+FROM\s*\((SELECT.+)\)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ORDER\s+BY\s+(.+)$/i,
      'SELECT $1 FROM ($2) AS "$3" ORDER BY $4',
    );
  }

  return walrusSql;
}
