export function normalizeSql(sql: string): string {
  return sql.trim().replace(/\s+/g, " ");
}
