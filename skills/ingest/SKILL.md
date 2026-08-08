---
description: Documents in, markdown out - converts files (docx, pdf, html, txt, md) and web pages into ./docs with source provenance, then refines and indexes them. Use for "/ingest", "convert this PDF", "import these docs", "pull that page into the repo".
argument-hint: "<file-or-url>... [--out <dir>] [--raw]"
model: haiku
effort: low
allowed-tools: Bash, Read, WebFetch, Write
---

# /ingest — documents in, markdown out

A script does everything deterministic: routing, conversion, source hashing, frontmatter, the index. You only do what needs judgment — reading a PDF, fetching a live page, and refining a rough conversion into something worth keeping.

Script: `node "${CLAUDE_PLUGIN_ROOT}/tools/ingest.js"`. Output defaults to `./docs`.

## Steps

1. **Plan first** — `ingest.js plan <input>...` prints, as JSON: the route per input, its slug, its source hash, whether an identical source was already ingested, and whether pandoc is available. Re-ingesting unchanged files is a no-op; say so and skip them rather than redoing the work.

2. **Convert, per input, by route:**

   | Route | What you do |
   |---|---|
   | `copy` (`.md`, `.txt`) | `ingest.js convert <file>` — verbatim, no model involved |
   | `pandoc` (`.docx`, `.odt`, `.rtf`, `.html`, `.epub`) | `ingest.js convert <file>` — pandoc does it. Missing pandoc? Point at `/partners` and move on; never hand-parse a docx |
   | `read` (`.pdf`) | Read the file yourself with the Read tool's `pages` parameter, **20 pages per call**, and keep going until the document is finished. Preserve headings, tables and lists; add no commentary. Then pipe the markdown into `ingest.js write <slug> --source <path> --sha <hash from plan>` |
   | `fetch` (URL) | WebFetch it, then pipe the markdown into `ingest.js write <slug> --source <url>` |
   | `unsupported` | Report the type and stop. Don't guess a converter |

3. **Refine** (skip only with `--raw`). Read what landed and fix what conversion mangles: stray page numbers and running headers, tables broken into loose lines, headings flattened to bold, footnote debris, hard-wrapped paragraphs. Keep the author's words — this is cleanup, not rewriting. Then re-`write` it with `--summary "<two lines on what this document is and who needs it>"` and `--tags "<3-5 comma-separated>"`, so the index is scannable and search has something to match.

4. **Index** — `ingest.js index` rebuilds `docs/00-index.md` from every document's frontmatter.

5. **Remember it** — one line per ingested document:
   `node "${CLAUDE_PLUGIN_ROOT}/hooks/engine.js" add reference "<title> ingested at docs/<slug>.md — <one line on what it covers>" 0.75`
   Future session briefs will know the document exists, which is the whole point of putting it in the repo.

6. **Report**: written · skipped-as-unchanged · failed-with-reason, and that `./docs` is shared with the team once committed.

## Rules

- A source is identified by its hash, not its filename — the same file under a new name is still already ingested.
- Never overwrite a document whose frontmatter `source` differs from what you're writing; the script refuses and reports the collision. Pick a distinct slug.
- URLs are always re-fetched — pages change, and there is no hash to compare beforehand.
- Big PDFs: keep reading in 20-page batches until the end. A truncated document is worse than none, because it looks complete.
