import type { CitationStyle } from "./doc-templates";

export interface Reference {
  id: string;
  cite_key: string;
  authors: string;
  year: number | null;
  title: string;
  container: string | null;
  publisher: string | null;
  doi: string | null;
  url: string | null;
}

function splitAuthors(authors: string): string[] {
  return authors
    .split(/;|,\s*and\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstAuthorLast(authors: string): string {
  const first = splitAuthors(authors)[0] ?? authors;
  // "Last, First" or "First Last"
  if (first.includes(",")) return first.split(",")[0].trim();
  const parts = first.split(/\s+/);
  return parts[parts.length - 1];
}

export function inTextCitation(ref: Reference, style: CitationStyle): string {
  const last = firstAuthorLast(ref.authors);
  const authors = splitAuthors(ref.authors);
  const y = ref.year ?? "n.d.";
  switch (style) {
    case "APA":
      if (authors.length === 1) return `(${last}, ${y})`;
      if (authors.length === 2) return `(${firstAuthorLast(authors[0])} & ${firstAuthorLast(authors[1])}, ${y})`;
      return `(${last} et al., ${y})`;
    case "MLA":
      return `(${last})`;
    case "Chicago":
      return `(${last} ${y})`;
    case "IEEE":
      return `[${ref.cite_key}]`;
  }
}

export function formatReference(ref: Reference, style: CitationStyle): string {
  const y = ref.year ?? "n.d.";
  const container = ref.container ? `${ref.container}` : "";
  const publisher = ref.publisher ?? "";
  const doi = ref.doi ? `https://doi.org/${ref.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, "")}` : ref.url ?? "";
  switch (style) {
    case "APA":
      return `${ref.authors} (${y}). ${ref.title}. ${container}${container && publisher ? ": " : ""}${publisher}. ${doi}`.trim();
    case "MLA":
      return `${ref.authors}. "${ref.title}." ${container}, ${publisher}, ${y}. ${doi}`.trim();
    case "Chicago":
      return `${ref.authors}. ${y}. "${ref.title}." ${container}. ${publisher}. ${doi}`.trim();
    case "IEEE":
      return `[${ref.cite_key}] ${ref.authors}, "${ref.title}," ${container}, ${publisher}, ${y}. ${doi}`.trim();
  }
}

export function formatReferenceList(refs: Reference[], style: CitationStyle): string {
  const sorted = [...refs].sort((a, b) => firstAuthorLast(a.authors).localeCompare(firstAuthorLast(b.authors)));
  return sorted.map((r) => formatReference(r, style)).join("\n\n");
}

// Very small BibTeX parser (best-effort) — accepts pasted @article/@book entries.
export function parseBibTeX(input: string): Array<Partial<Reference>> {
  const entries: Array<Partial<Reference>> = [];
  const regex = /@(\w+)\s*\{\s*([^,]+),([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(input))) {
    const cite_key = m[2].trim();
    const body = m[3];
    const fields: Record<string, string> = {};
    const fieldRe = /(\w+)\s*=\s*[\{"]([\s\S]*?)[\}"]\s*,?/g;
    let f: RegExpExecArray | null;
    while ((f = fieldRe.exec(body))) {
      fields[f[1].toLowerCase()] = f[2].replace(/\s+/g, " ").trim();
    }
    entries.push({
      cite_key,
      authors: fields.author ?? "",
      title: fields.title ?? "",
      year: fields.year ? parseInt(fields.year, 10) : null,
      container: fields.journal ?? fields.booktitle ?? null,
      publisher: fields.publisher ?? null,
      doi: fields.doi ?? null,
      url: fields.url ?? null,
    });
  }
  return entries;
}
