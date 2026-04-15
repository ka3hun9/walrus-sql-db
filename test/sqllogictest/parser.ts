/**
 * sqllogictest file format parser
 *
 * Parses .slt files into SltDocument structures.
 *
 * Token types:
 * - comment:    # ... (preserved for traceability)
 * - blank:     empty line (separator)
 * - statement: statement [ok|error <code>|<mode>]
 * - query:     query [<mode>] <typesig>
 * - ----:      result separator (results follow)
 * - skipif:    skipif <condition>  (file-level)
 * - onlyif:    onlyif <condition> (file-level)
 * - halt:      stop processing
 * - loop:      loop <var> <start> <end> ... end loop
 * - hash-threshold: hash-threshold <n>
 */

import type {
  SltDocument,
  SltElement,
  SltStatement,
  SltQuery,
  SltMode,
  SltTypeSignature,
  SltBlank,
  SltHalt,
  SltHashThreshold,
  SltSkipIf,
  SltOnlyIf,
  SltLoop,
} from "./types.js";

const RESULT_SEP = "----";

/** Parse a type signature string like "IIT*" into typed columns */
function parseTypeSignature(raw: string): SltTypeSignature {
  const columns: SltTypeSignature["columns"] = [];
  for (const ch of raw.trim()) {
    if (ch === " " || ch === "\t") continue;
    columns.push(ch as SltTypeSignature["columns"][number]);
  }
  return { raw: raw.trim(), columns };
}

function tokenizeHeader(line: string): string[] {
  return line.trim().split(/\s+/);
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function isResultSep(line: string): boolean {
  return line.trim() === RESULT_SEP;
}

function parseHashThreshold(line: string): number | null {
  const m = line.match(/^hash-threshold\s+(\d+)/i);
  return m ? parseInt(m[1]!, 10) : null;
}

function parseFileGuard(line: string): { kind: "skipif" | "onlyif"; condition: string } | null {
  const skip = line.match(/^skipif\s+(.+)/i);
  if (skip) return { kind: "skipif", condition: skip[1]!.trim() };
  const only = line.match(/^onlyif\s+(.+)/i);
  if (only) return { kind: "onlyif", condition: only[1]!.trim() };
  return null;
}

function isHalt(line: string): boolean {
  return /^halt\b/i.test(line.trim());
}

function isLoopStart(line: string): boolean {
  return /^loop\s+\w+\s+\d+\s+\d+$/i.test(line.trim());
}

function isLoopEnd(line: string): boolean {
  return /^end\s+loop$/i.test(line.trim());
}

/** Collect SQL lines for a query or statement until a blank line or result separator */
function collectSqlLines(lines: string[], startIdx: number): { sqlLines: string[]; endIdx: number } {
  const sqlLines: string[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const l = lines[i]!.trim();
    if (l === "" || isResultSep(l)) break;
    sqlLines.push(l);
    i++;
  }
  return { sqlLines, endIdx: i };
}

/** Collect result lines until a blank line or result separator or statement header */
function isStatementOrQueryHeader(line: string): boolean {
  const t = line.trim();
  return /^statement\s+/i.test(t)
    || /^query\s+/i.test(t)
    || /^skipif\s+/i.test(t)
    || /^onlyif\s+/i.test(t)
    || /^halt\b/i.test(t)
    || /^loop\s+/i.test(t)
    || /^end\s+loop$/i.test(t)
    || /^hash-threshold\s+/i.test(t);
}

function collectResultLines(lines: string[], startIdx: number): { resultLines: string[]; endIdx: number } {
  const resultLines: string[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const l = lines[i]!;
    if (isBlank(l) || isResultSep(l) || isStatementOrQueryHeader(l)) break;
    resultLines.push(l);
    i++;
  }
  return { resultLines, endIdx: i };
}

/** Main parser */
function parseSltDocument(source: string, filePath: string): SltDocument {
  // Normalize line endings
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const elements: SltElement[] = [];
  const fileSkipIf: string[] = [];
  const fileOnlyIf: string[] = [];
  let hashThreshold = 1000;
  let halted = false;
  const lineOffset = 1; // 1-indexed

  let i = 0;
  while (i < lines.length) {
    if (halted) break;

    const raw = lines[i]!;
    const trimmed = raw.trim();
    const lineNum = i + lineOffset;

    // Blank line
    if (isBlank(trimmed)) {
      elements.push({ kind: "blank", line: lineNum });
      i++;
      continue;
    }

    // Comment
    if (trimmed.startsWith("#")) {
      elements.push({ kind: "comment", line: lineNum, text: trimmed });
      i++;
      continue;
    }

    // hash-threshold
    const ht = parseHashThreshold(trimmed);
    if (ht !== null) {
      hashThreshold = ht;
      elements.push({ kind: "hash-threshold", line: lineNum, threshold: ht });
      i++;
      continue;
    }

    // File-level skipif/onlyif
    const guard = parseFileGuard(trimmed);
    if (guard) {
      if (guard.kind === "skipif") {
        fileSkipIf.push(guard.condition);
        elements.push({ kind: "skipif", line: lineNum, condition: guard.condition });
      } else {
        fileOnlyIf.push(guard.condition);
        elements.push({ kind: "onlyif", line: lineNum, condition: guard.condition });
      }
      i++;
      continue;
    }

    // halt
    if (isHalt(trimmed)) {
      halted = true;
      elements.push({ kind: "halt", line: lineNum });
      i++;
      continue;
    }

    // loop ... end loop
    if (isLoopStart(trimmed)) {
      const parts = trimmed.split(/\s+/);
      const variable = parts[1]!;
      const start = parseInt(parts[2]!, 10);
      const end = parseInt(parts[3]!, 10);

      // Collect body lines until matching 'end loop'
      const bodyLines: string[] = [];
      let j = i + 1;
      let depth = 1;
      while (j < lines.length && depth > 0) {
        const l = lines[j]!.trim();
        if (isLoopStart(l)) depth++;
        else if (isLoopEnd(l)) depth--;
        if (depth > 0) bodyLines.push(lines[j]!);
        j++;
      }

      // Parse body as inline SLT (recursively, simplified)
      const bodyElements = parseInlineBody(bodyLines, lineOffset + 1);

      // Expand loop: substitute $var for each iteration
      const loopLine = lineNum;
      const expandedElements: SltElement[] = [];
      for (let v = start; v <= end; v++) {
        for (const el of bodyElements) {
          expandedElements.push(substituteVariable(el, variable, String(v)));
        }
      }

      elements.push(...expandedElements);
      i = j; // advance past 'end loop'
      continue;
    }

    // query header
    if (/^query\s+/i.test(trimmed)) {
      const headerToks = tokenizeHeader(trimmed);
      let mode: SltMode = "tabs"; // Default to tab-separated values (standard SLT)
      let sigStartIdx = 1;

      if (headerToks.length >= 2 && /^[IRTB*\?]+$/i.test(headerToks[1]!)) {
        // First token is typesig (no mode)
        sigStartIdx = 1;
      } else if (headerToks.length >= 3 && /^[IRTB*\?]+$/i.test(headerToks[2]!)) {
        // Second token is mode
        mode = headerToks[1]!;
        sigStartIdx = 2;
      } else if (headerToks.length >= 2) {
        // Only typesig given, no mode
        sigStartIdx = 1;
      }

      const rawSig = headerToks.slice(sigStartIdx).join(" ");
      const typeSignature = parseTypeSignature(rawSig);
      const unordered = trimmed.includes("unordered");

      // Collect SQL lines
      const { sqlLines, endIdx: sqlEndIdx } = collectSqlLines(lines, i + 1);

      // Skip ----
      let resultStartIdx = sqlEndIdx;
      if (resultStartIdx < lines.length && isResultSep(lines[resultStartIdx]!)) {
        resultStartIdx++;
      }

      // Collect result lines
      const { resultLines, endIdx: resultEndIdx } = collectResultLines(lines, resultStartIdx);

      elements.push({
        kind: "query",
        line: lineNum,
        mode,
        typeSignature,
        sql: sqlLines.join("\n"),
        skipIf: [],
        onlyIf: [],
        results: resultLines,
        unordered,
      } satisfies SltQuery);

      i = resultEndIdx;
      if (i < lines.length && isBlank(lines[i]!)) {
        elements.push({ kind: "blank", line: i + lineOffset });
        i++;
      }
      continue;
    }

    // statement header
    if (/^statement\s+/i.test(trimmed)) {
      const rest = trimmed.slice("statement".length).trim();
      let type = "ok";
      let errorCode: string | undefined;

      if (rest === "") {
        type = "ok";
      } else if (/^error\s+/i.test(rest)) {
        type = "error";
        errorCode = rest.replace(/^error\s+/i, "").trim() || undefined;
      } else {
        type = rest; // mode string
      }

      // Collect SQL lines
      const { sqlLines, endIdx } = collectSqlLines(lines, i + 1);

      elements.push({
        kind: "statement",
        line: lineNum,
        type,
        errorCode,
        sql: sqlLines.join("\n"),
        skipIf: [],
        onlyIf: [],
      } satisfies SltStatement);

      i = endIdx;
      if (i < lines.length && isBlank(lines[i]!)) {
        elements.push({ kind: "blank", line: i + lineOffset });
        i++;
      }
      continue;
    }

    // Unknown — skip
    elements.push({ kind: "unknown", line: lineNum, text: trimmed });
    i++;
  }

  return {
    filePath,
    elements,
    fileSkipIf,
    fileOnlyIf,
    hashThreshold,
    halted,
  };
}

/** Parse body lines inside a loop (simplified — handles query/statement) */
function parseInlineBody(bodyLines: string[], lineOffset: number): SltElement[] {
  const elements: SltElement[] = [];
  let i = 0;

  while (i < bodyLines.length) {
    const raw = bodyLines[i]!;
    const trimmed = raw.trim();
    const lineNum = i + lineOffset;

    if (isBlank(trimmed)) { i++; continue; }
    if (trimmed.startsWith("#")) { i++; continue; }

    // query
    if (/^query\s+/i.test(trimmed)) {
      const headerToks = tokenizeHeader(trimmed);
      let mode: SltMode = "tabs"; // Default to tab-separated values (standard SLT)
      let sigStartIdx = 1;
      if (headerToks.length >= 3 && /^[IRTB*\?]+$/i.test(headerToks[2]!)) {
        mode = headerToks[1]!;
        sigStartIdx = 2;
      } else if (headerToks.length >= 2 && /^[IRTB*\?]+$/i.test(headerToks[1]!)) {
        sigStartIdx = 1;
      }
      const rawSig = headerToks.slice(sigStartIdx).join(" ");
      const typeSignature = parseTypeSignature(rawSig);

      const sqlLines: string[] = [];
      let j = i + 1;
      while (j < bodyLines.length && !isBlank(bodyLines[j]!) && !isResultSep(bodyLines[j]!)) {
        sqlLines.push(bodyLines[j]!);
        j++;
      }

      let resultStartIdx = j;
      if (resultStartIdx < bodyLines.length && isResultSep(bodyLines[resultStartIdx]!)) {
        resultStartIdx++;
      }

      const resultLines: string[] = [];
      let k = resultStartIdx;
      while (k < bodyLines.length && !isBlank(bodyLines[k]!)) {
        resultLines.push(bodyLines[k]!);
        k++;
      }

      elements.push({
        kind: "query",
        line: lineNum,
        mode,
        typeSignature,
        sql: sqlLines.join("\n"),
        skipIf: [],
        onlyIf: [],
        results: resultLines,
        unordered: trimmed.includes("unordered"),
      } satisfies SltQuery);

      i = k;
      continue;
    }

    // statement
    if (/^statement\s+/i.test(trimmed)) {
      const rest = trimmed.slice("statement".length).trim();
      let type = "ok";
      let errorCode: string | undefined;
      if (rest === "") {
        type = "ok";
      } else if (/^error\s+/i.test(rest)) {
        type = "error";
        errorCode = rest.replace(/^error\s+/i, "").trim() || undefined;
      } else {
        type = rest;
      }

      const sqlLines: string[] = [];
      let j = i + 1;
      while (j < bodyLines.length && !isBlank(bodyLines[j]!)) {
        sqlLines.push(bodyLines[j]!);
        j++;
      }

      elements.push({
        kind: "statement",
        line: lineNum,
        type,
        errorCode,
        sql: sqlLines.join("\n"),
        skipIf: [],
        onlyIf: [],
      } satisfies SltStatement);

      i = j;
      continue;
    }

    i++;
  }

  return elements;
}

/** Substitute loop variable $var in a block */
function substituteVariable(el: SltElement, variable: string, value: string): SltElement {
  const replace = (s: string) => s.split(`$${variable}`).join(value);
  if (el.kind === "statement") {
    return { ...el, sql: replace(el.sql) };
  }
  if (el.kind === "query") {
    return { ...el, sql: replace(el.sql) };
  }
  return el;
}

/** Parse an SLT file from a string */
export function parseSlt(source: string, filePath = "inline.slt"): SltDocument {
  return parseSltDocument(source, filePath);
}
