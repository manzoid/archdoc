import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join, basename } from "path";
import chalk from "chalk";
import type { WikiManifest, ManifestPage } from "../types/wiki.js";
import { discoverPages } from "./discover-pages.js";

export async function renderBareHtml(outputDir: string): Promise<void> {
  const manifestPath = join(outputDir, "manifest.json");
  const raw = await readFile(manifestPath, "utf-8");
  const manifest: WikiManifest = JSON.parse(raw);

  const renderDir = join(outputDir, "site");
  await mkdir(renderDir, { recursive: true });

  const pages = await discoverPages(outputDir, manifest);

  // Render each page
  for (const page of pages) {
    const mdPath = join(outputDir, page.file);
    const mdContent = await readFile(mdPath, "utf-8");
    const { body } = stripFrontmatter(mdContent);
    const html = wrapPage(manifest, pages, page, markdownToHtml(body, pages));
    const outFile = join(renderDir, `${page.slug}.html`);
    await writeFile(outFile, html);
    console.log(chalk.dim(`  ✓ ${page.slug}.html`));
  }

  // Render index
  const indexHtml = renderIndex(manifest, pages);
  await writeFile(join(renderDir, "index.html"), indexHtml);
  console.log(chalk.dim("  ✓ index.html"));

  // Copy artifact files into site dir
  for (const artifact of manifest.artifacts) {
    try {
      const content = await readFile(join(outputDir, artifact.file), "utf-8");
      await writeFile(join(renderDir, artifact.file), content);
      console.log(chalk.dim(`  ✓ ${artifact.file} (artifact)`));
    } catch {
      // Artifact may not exist yet (produced by enrich step)
    }
  }
}

function stripFrontmatter(md: string): { frontmatter: string; body: string } {
  const match = md.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (match) return { frontmatter: match[1], body: match[2] };
  return { frontmatter: "", body: md };
}

function markdownToHtml(md: string, pages: ManifestPage[]): string {
  let html = md;

  // Resolve [[cross-ref]] wiki links
  html = html.replace(/\[\[([^\]]+)\]\]/g, (_match, title) => {
    const slug = pages.find(
      (p) => p.title.toLowerCase() === title.toLowerCase() || p.slug === title.toLowerCase().replace(/\s+/g, "-")
    )?.slug;
    if (slug) return `<a href="${slug}.html">${escapeHtml(title)}</a>`;
    return escapeHtml(title);
  });

  // Mermaid blocks
  html = html.replace(/```mermaid\n([\s\S]*?)```/g, (_m, code) =>
    `<pre class="mermaid">${code.trimEnd()}</pre>`
  );

  // Headers
  html = html.replace(/^#{6}\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#{5}\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^#{4}\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
    `<pre><code>${escapeHtml(code.trimEnd())}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Horizontal rule
  html = html.replace(/^---$/gm, "<hr>");

  // Tables
  html = processMarkdownTables(html);

  // Links (markdown style)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Lists (simple single-level)
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, "<ul>\n$1</ul>\n");

  // Paragraphs — wrap remaining bare lines
  const lines = html.split("\n");
  const result: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    if (line.startsWith("<pre>") || line.startsWith("<table")) inBlock = true;
    if (line.includes("</pre>") || line.includes("</table>")) {
      result.push(line);
      inBlock = false;
      continue;
    }
    if (inBlock || line.startsWith("<") || line.trim() === "") {
      result.push(line);
    } else {
      result.push(`<p>${line}</p>`);
    }
  }

  return result.join("\n");
}

function processMarkdownTables(html: string): string {
  const lines = html.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Detect table: line with |, followed by separator line with |---|
    if (
      lines[i]?.includes("|") &&
      i + 1 < lines.length &&
      /^\|[\s-:|]+\|$/.test(lines[i + 1]?.trim() ?? "")
    ) {
      const headerCells = parseTableRow(lines[i]);
      i += 2; // skip header and separator

      result.push("<table>");
      result.push("<thead><tr>");
      for (const cell of headerCells) {
        result.push(`<th>${cell.trim()}</th>`);
      }
      result.push("</tr></thead>");
      result.push("<tbody>");

      while (i < lines.length && lines[i]?.includes("|")) {
        const cells = parseTableRow(lines[i]);
        result.push("<tr>");
        for (const cell of cells) {
          result.push(`<td>${cell.trim()}</td>`);
        }
        result.push("</tr>");
        i++;
      }

      result.push("</tbody>");
      result.push("</table>");
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join("\n");
}

function parseTableRow(line: string): string[] {
  return line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nav(pages: ManifestPage[], currentSlug?: string): string {
  const links = pages
    .map((p) => {
      const active = p.slug === currentSlug ? ' class="active"' : "";
      return `<li><a href="${p.slug}.html"${active}>${escapeHtml(p.title)}</a></li>`;
    })
    .join("\n      ");
  return `<nav>
    <a href="index.html"><strong>archdoc</strong></a>
    <ul>
      ${links}
    </ul>
  </nav>`;
}

function wrapPage(
  manifest: WikiManifest,
  pages: ManifestPage[],
  page: ManifestPage,
  bodyHtml: string
): string {
  const tagsList = page.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ");
  const crossRefLinks = page.crossRefs
    .map((ref) => {
      const target = pages.find((p) => p.slug === ref);
      return target ? `<a href="${ref}.html">${escapeHtml(target.title)}</a>` : null;
    })
    .filter(Boolean)
    .join(" · ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(page.title)} — ${escapeHtml(manifest.repo)} archdoc</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; line-height: 1.6; }
  nav { margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid #ccc; }
  nav ul { list-style: none; padding: 0; display: flex; gap: 16px; flex-wrap: wrap; margin: 8px 0 0 0; }
  nav a { text-decoration: none; color: #0366d6; }
  nav a.active { font-weight: bold; text-decoration: underline; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  th { background: #f6f8fa; }
  pre { background: #f6f8fa; padding: 12px; overflow-x: auto; border-radius: 4px; }
  code { font-size: 0.9em; }
  .tag { display: inline-block; background: #eef; padding: 1px 8px; border-radius: 10px; font-size: 0.8em; }
  .meta { color: #666; font-size: 0.85em; margin-bottom: 20px; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 0.8em; color: #999; }
</style>
</head>
<body>
${nav(pages, page.slug)}
<article>
<div class="meta">
  ${tagsList}${crossRefLinks ? ` · See also: ${crossRefLinks}` : ""}
</div>
${bodyHtml}
</article>
<footer>Generated by archdoc · ${manifest.generatedAt.slice(0, 10)}</footer>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'default' });
</script>
</body>
</html>`;
}

function renderIndex(manifest: WikiManifest, pages: ManifestPage[]): string {
  const pageLinks = pages
    .map((p) => `<li><a href="${p.slug}.html">${escapeHtml(p.title)}</a> — ${p.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ")}</li>`)
    .join("\n    ");

  const artifactLinks = manifest.artifacts
    .map((a) => `<li><a href="${a.file}">${escapeHtml(a.file)}</a> — ${escapeHtml(a.description)}</li>`)
    .join("\n    ");

  const harvestRows = manifest.harvest
    .map((h) => `<tr><td>${escapeHtml(h.id)}</td><td>${h.status}</td><td>${h.durationMs != null ? h.durationMs + "ms" : "—"}</td></tr>`)
    .join("\n    ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(manifest.repo)} — archdoc</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; line-height: 1.6; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  th { background: #f6f8fa; }
  .tag { display: inline-block; background: #eef; padding: 1px 8px; border-radius: 10px; font-size: 0.8em; }
  footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #ccc; font-size: 0.8em; color: #999; }
  a { color: #0366d6; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<h1>${escapeHtml(manifest.repo)}</h1>
<p>archdoc wiki · ${escapeHtml(manifest.targetPath)}</p>

<h2>Pages</h2>
<ul>
    ${pageLinks}
</ul>

${manifest.artifacts.length > 0 ? `<h2>Artifacts</h2>
<ul>
    ${artifactLinks}
</ul>` : ""}

<h2>Harvest Tools</h2>
<table>
<thead><tr><th>Tool</th><th>Status</th><th>Duration</th></tr></thead>
<tbody>
    ${harvestRows}
</tbody>
</table>

<p>Tags: ${manifest.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(" ")}</p>

<footer>Generated by archdoc · ${manifest.generatedAt.slice(0, 10)}</footer>
</body>
</html>`;
}
