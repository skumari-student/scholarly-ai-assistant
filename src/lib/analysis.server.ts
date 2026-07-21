// Server-only dataset parsing helpers.
// Bounded to keep AI prompts cheap.

export interface ParsedDataset {
  columns: string[];
  rows: (string | number)[][];
  rowCount: number;
  truncated: boolean;
}

const MAX_ROWS = 200;
const MAX_COLS = 20;

function detectDelim(line: string): string {
  const counts = { ",": 0, "\t": 0, ";": 0 } as Record<string, number>;
  for (const c of line) if (c in counts) counts[c]++;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ",";
}

function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuote = false;
      } else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === delim) {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function coerce(v: string): string | number {
  if (v === "" || v == null) return "";
  const n = Number(v.replace(/[,%$\s]/g, ""));
  return Number.isFinite(n) && /^-?\d/.test(v.trim()) ? n : v;
}

export function parseCsv(text: string): ParsedDataset {
  const clean = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!clean) return { columns: [], rows: [], rowCount: 0, truncated: false };
  const lines = clean.split("\n").filter((l) => l.length > 0);
  const delim = detectDelim(lines[0]);
  const header = splitLine(lines[0], delim).slice(0, MAX_COLS).map((h, i) => h || `col_${i + 1}`);
  const rows: (string | number)[][] = [];
  const total = lines.length - 1;
  for (let i = 1; i < lines.length && rows.length < MAX_ROWS; i++) {
    const cells = splitLine(lines[i], delim).slice(0, MAX_COLS);
    while (cells.length < header.length) cells.push("");
    rows.push(cells.map(coerce));
  }
  return { columns: header, rows, rowCount: total, truncated: total > rows.length };
}

export async function parseXlsx(bytes: ArrayBuffer): Promise<ParsedDataset> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(bytes, { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { columns: [], rows: [], rowCount: 0, truncated: false };
  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, blankrows: false, defval: "" });
  if (!aoa.length) return { columns: [], rows: [], rowCount: 0, truncated: false };
  const rawHeader = (aoa[0] as any[]).slice(0, MAX_COLS);
  const columns = rawHeader.map((h, i) => (h == null || h === "" ? `col_${i + 1}` : String(h)));
  const total = aoa.length - 1;
  const rows: (string | number)[][] = [];
  for (let i = 1; i < aoa.length && rows.length < MAX_ROWS; i++) {
    const r = (aoa[i] as any[]).slice(0, MAX_COLS);
    while (r.length < columns.length) r.push("");
    rows.push(
      r.map((v) => {
        if (typeof v === "number") return v;
        if (v == null) return "";
        return coerce(String(v));
      }),
    );
  }
  return { columns, rows, rowCount: total, truncated: total > rows.length };
}

export function summarizeForPrompt(ds: ParsedDataset, sampleRows = 40): string {
  const sample = ds.rows.slice(0, sampleRows);
  const lines: string[] = [];
  lines.push(`Columns (${ds.columns.length}): ${ds.columns.join(", ")}`);
  lines.push(`Total rows: ${ds.rowCount}${ds.truncated ? " (truncated in preview)" : ""}`);
  lines.push(`Sample (${sample.length} rows):`);
  lines.push(ds.columns.join("\t"));
  for (const r of sample) lines.push(r.map((v) => (v === "" ? "" : String(v))).join("\t"));
  return lines.join("\n");
}
