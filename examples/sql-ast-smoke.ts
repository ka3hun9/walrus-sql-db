import { parseSqlToAst } from "../src/sql-parser.js";

const sql = "SELECT id, SUM(amount) AS total FROM orders WHERE amount > 10 GROUP BY id HAVING total > 20 ORDER BY id DESC LIMIT 5 OFFSET 2";
const ast = parseSqlToAst(sql);

console.log(JSON.stringify(ast, null, 2));
