import { readFile, writeFile, readdir, mkdir } from "fs/promises";
import { join } from "path";
import chalk from "chalk";
import type { WikiManifest, ManifestPage } from "../types/wiki.js";
import { discoverPages } from "./discover-pages.js";
import { wrapSvgAsPage } from "./svg-page.js";

interface HtmlArtifactPage {
  title: string;
  slug: string;
  file: string;
  order: number;
}

/**
 * Discover standalone HTML files in outputDir that should become full pages.
 * Excludes files that are clearly not page content (e.g. index.html).
 */
async function discoverHtmlPages(outputDir: string): Promise<HtmlArtifactPage[]> {
  const files = await readdir(outputDir);
  const htmlFiles = files.filter(
    (f) => f.endsWith(".html") && f !== "index.html"
  );

  return htmlFiles.map((file) => {
    const slug = file.replace(/\.html$/, "");
    const title = inferHtmlTitle(file);
    return { title, slug, file, order: 90 };
  });
}


async function discoverSvgPages(outputDir: string): Promise<HtmlArtifactPage[]> {
  const files = await readdir(outputDir);
  const svgFiles = files.filter((f) => f.endsWith(".svg"));
  return svgFiles.map((file) => {
    const slug = file.replace(/\.svg$/, "");
    const title = inferHtmlTitle(file);
    return { title, slug, file, order: 91 };
  });
}

function inferHtmlTitle(filename: string): string {
  // Strip repo-name prefix (e.g. "myrepo-test-intent-map.html" -> "test-intent-map")
  const base = filename.replace(/\.html$|.svg$/, "");
  const parts = base.split("-");
  // If first part looks like a repo name prefix, try removing it
  // Heuristic: if removing first segment still leaves a meaningful name
  const name = parts.length > 2 ? parts.slice(1).join("-") : base;
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function injectSiteHeader(html: string, repo: string): string {
  const header = `<div style="
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: #1a1d23; color: #c8ccd4; padding: 10px 20px;
    display: flex; align-items: center; gap: 16px;
    border-bottom: 1px solid #2a2f3a; font-size: 13px;
  ">
    <a href="index.html" style="color: #d4915e; text-decoration: none; font-weight: 600;">\u2190 ${escapeHtml(repo)}</a>
    <span style="color: #6b7280;">archdoc</span>
  </div>`;
  return html.replace("<body>", `<body>\n${header}`);
}

export async function renderSiteHtml(outputDir: string): Promise<void> {
  const manifestPath = join(outputDir, "manifest.json");
  const raw = await readFile(manifestPath, "utf-8");
  const manifest: WikiManifest = JSON.parse(raw);

  const renderDir = join(outputDir, "site-fancy");
  await mkdir(renderDir, { recursive: true });

  const pages = await discoverPages(outputDir, manifest);
  const htmlPages = await discoverHtmlPages(outputDir);
  const svgPages = await discoverSvgPages(outputDir);

  // Read all page content
  const pageData: { page: ManifestPage; html: string }[] = [];
  for (const page of pages) {
    const mdPath = join(outputDir, page.file);
    const mdContent = await readFile(mdPath, "utf-8");
    const { body } = stripFrontmatter(mdContent);
    pageData.push({ page, html: markdownToHtml(body, pages) });
  }


  // Write standalone HTML pages with a back-to-site header
  for (const hp of htmlPages) {
    let src = await readFile(join(outputDir, hp.file), "utf-8");
    src = injectSiteHeader(src, manifest.repo);
    await writeFile(join(renderDir, hp.file), src);
    console.log(chalk.dim(`  \u2713 ${hp.file} (standalone page)`));
  }

  // Write SVG diagrams as standalone pages + raw SVGs for inline refs
  for (const sp of svgPages) {
    const svgContent = await readFile(join(outputDir, sp.file), "utf-8");
    await writeFile(join(renderDir, sp.file), svgContent);
    const svgHtml = wrapSvgAsPage(svgContent, sp.title, manifest.repo);
    await writeFile(join(renderDir, sp.slug + ".html"), svgHtml);
    console.log(chalk.dim("  ✓ " + sp.file + " (diagram page)"));
  }

  const html = buildSinglePageApp(manifest, pages, pageData, htmlPages, svgPages);
  await writeFile(join(renderDir, "index.html"), html);
  console.log(chalk.dim("  ✓ index.html"));
}

function stripFrontmatter(md: string): { body: string } {
  const match = md.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/);
  return { body: match ? match[1] : md };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function markdownToHtml(md: string, pages: ManifestPage[]): string {
  let html = md;

  // Wiki links
  html = html.replace(/\[\[([^\]]+)\]\]/g, (_m, title) => {
    const slug = pages.find(
      (p) => p.title.toLowerCase() === title.toLowerCase() || p.slug === title.toLowerCase().replace(/\s+/g, "-")
    )?.slug;
    if (slug) return `<a href="#" data-page="${slug}" class="wiki-link">${escapeHtml(title)}</a>`;
    return escapeHtml(title);
  });

  // Mermaid blocks — keep raw for client-side rendering
  html = html.replace(/```mermaid\n([\s\S]*?)```/g, (_m, code) =>
    `<pre class="mermaid">${code.trimEnd()}</pre>`
  );

  // Code blocks (non-mermaid)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) =>
    `<pre class="code-block"><code${lang ? ` class="lang-${lang}"` : ""}>${escapeHtml(code.trimEnd())}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="inline">$1</code>');

  // Headers
  html = html.replace(/^#{4,6}\s+(.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

  // Bold/italic
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // HR
  html = html.replace(/^---$/gm, '<hr class="divider">');

  // Tables
  html = processMarkdownTables(html);

  // Markdown images (must be before links)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m: string, alt: string, src: string) => { if (src.endsWith('.svg')) { const page = src.replace(/\.svg$/, '.html'); return '<a href="' + page + '" class="diagram-link" title="Click to view full size"><img src="' + src + '" alt="' + escapeHtml(alt) + '" class="content-img"></a>'; } return '<img src="' + src + '" alt="' + escapeHtml(alt) + '" class="content-img">'; });

  // Markdown links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="ext-link">$1</a>');

  // Lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul class="content-list">\n$1</ul>\n');

  // Paragraphs
  const lines = html.split("\n");
  const result: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.startsWith("<pre") || line.startsWith("<table")) inBlock = true;
    if (line.includes("</pre>") || line.includes("</table>")) { result.push(line); inBlock = false; continue; }
    if (inBlock || line.startsWith("<") || line.trim() === "") { result.push(line); }
    else { result.push(`<p>${line}</p>`); }
  }

  return result.join("\n");
}

function processMarkdownTables(html: string): string {
  const lines = html.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (lines[i]?.includes("|") && i + 1 < lines.length && /^\|[\s-:|]+\|$/.test(lines[i + 1]?.trim() ?? "")) {
      const headerCells = parseTableRow(lines[i]);
      // Detect alignment from separator
      const sepCells = parseTableRow(lines[i + 1]);
      const aligns = sepCells.map((c) => {
        const t = c.trim();
        if (t.startsWith(":") && t.endsWith(":")) return "center";
        if (t.endsWith(":")) return "right";
        return "left";
      });
      i += 2;

      result.push('<div class="table-wrap"><table>');
      result.push("<thead><tr>");
      headerCells.forEach((cell, ci) => {
        const align = aligns[ci] || "left";
        result.push(`<th style="text-align:${align}">${cell.trim()}</th>`);
      });
      result.push("</tr></thead><tbody>");

      while (i < lines.length && lines[i]?.includes("|")) {
        const cells = parseTableRow(lines[i]);
        result.push("<tr>");
        cells.forEach((cell, ci) => {
          const align = aligns[ci] || "left";
          result.push(`<td style="text-align:${align}">${cell.trim()}</td>`);
        });
        result.push("</tr>");
        i++;
      }
      result.push("</tbody></table></div>");
    } else {
      result.push(lines[i]);
      i++;
    }
  }
  return result.join("\n");
}

function parseTableRow(line: string): string[] {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|");
}

function buildSinglePageApp(
  manifest: WikiManifest,
  pages: ManifestPage[],
  pageData: { page: ManifestPage; html: string }[],
  htmlPages: HtmlArtifactPage[],
  svgPages: HtmlArtifactPage[]
): string {
  const allTags = manifest.tags;

  const navItems = pages.map((p) =>
    `<li>
      <a href="#" data-page="${p.slug}" class="nav-link" data-tags='${JSON.stringify(p.tags)}'>
        <span class="nav-order">${String(p.order).padStart(2, "0")}</span>
        <span class="nav-title">${escapeHtml(p.title)}</span>
      </a>
    </li>`
  ).join("\n");

  const htmlNavItems = htmlPages.map((hp) =>
    `<li>
      <a href="${hp.file}" class="nav-link">
        <span class="nav-order">${String(hp.order).padStart(2, "0")}</span>
        <span class="nav-title">${escapeHtml(hp.title)}</span>
      </a>
    </li>`
  ).join("\n");

  const svgNavItems = svgPages.map((sp) =>
    `<li>
      <a href="${sp.slug}.html" class="nav-link">
        <span class="nav-order">${String(sp.order).padStart(2, "0")}</span>
        <span class="nav-title">${escapeHtml(sp.title)}</span>
      </a>
    </li>`
  ).join("\n");

  const tagPills = allTags.map((t) =>
    `<button class="tag-pill" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`
  ).join("\n");

  const pageSections = pageData.map(({ page, html }) => {
    return `<section class="page-section" data-page="${page.slug}" data-tags='${JSON.stringify(page.tags)}'>
      ${html}
    </section>`;
  }).join("\n");



  const harvestRows = manifest.harvest.map((h) => {
    const statusClass = h.status === "success" ? "status-ok" : h.status === "error" ? "status-err" : "status-skip";
    return `<tr><td>${escapeHtml(h.id)}</td><td><span class="${statusClass}">${h.status}</span></td><td>${h.durationMs != null ? h.durationMs + "ms" : "\u2014"}</td></tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(manifest.repo)} \u2014 archdoc</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap" rel="stylesheet">
<style>
  :root {
    --bg-deep: #0c0e12;
    --bg-sidebar: #12151b;
    --bg-content: #181b22;
    --bg-surface: #1e222b;
    --bg-hover: #252a35;
    --border: #2a2f3a;
    --border-light: #353b48;
    --text: #c8ccd4;
    --text-dim: #6b7280;
    --text-bright: #e8ecf4;
    --accent: #d4915e;
    --accent-glow: #d4915e33;
    --accent-dim: #a06b3f;
    --tag-bg: #1a2332;
    --tag-text: #7da4c7;
    --tag-active-bg: #d4915e22;
    --tag-active-text: #d4915e;
    --success: #5ba874;
    --error: #c75a5a;
    --skip: #6b7280;
    --mono: 'DM Mono', 'SF Mono', 'Fira Code', monospace;
    --serif: 'Newsreader', 'Georgia', serif;
    --sidebar-w: 280px;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html { font-size: 15px; -webkit-font-smoothing: antialiased; }

  body {
    font-family: var(--serif);
    background: var(--bg-deep);
    color: var(--text);
    line-height: 1.72;
    display: flex;
    min-height: 100vh;
  }

  /* ── Sidebar ─────────────────────────────── */

  .sidebar {
    width: var(--sidebar-w);
    min-width: var(--sidebar-w);
    background: var(--bg-sidebar);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    z-index: 10;
    overflow-y: auto;
  }

  .sidebar-header {
    padding: 28px 24px 20px;
    border-bottom: 1px solid var(--border);
  }

  .sidebar-brand {
    font-family: var(--mono);
    font-size: 0.7rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 4px;
  }

  .sidebar-repo {
    font-family: var(--serif);
    font-size: 1.35rem;
    font-weight: 600;
    color: var(--text-bright);
    letter-spacing: -0.01em;
  }

  .sidebar-meta {
    font-family: var(--mono);
    font-size: 0.65rem;
    color: var(--text-dim);
    margin-top: 8px;
    line-height: 1.5;
  }

  .nav-section-label {
    font-family: var(--mono);
    font-size: 0.6rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-dim);
    padding: 20px 24px 8px;
  }

  .nav-list {
    list-style: none;
    padding: 0 12px;
  }

  .nav-link {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 6px;
    text-decoration: none;
    color: var(--text);
    transition: all 0.15s ease;
    font-size: 0.9rem;
  }

  .nav-link:hover { background: var(--bg-hover); color: var(--text-bright); }
  .nav-link.active { background: var(--accent-glow); color: var(--accent); }
  .nav-link.active .nav-order { color: var(--accent); }
  .nav-link.dimmed { opacity: 0.25; pointer-events: none; }

  .nav-order {
    font-family: var(--mono);
    font-size: 0.6rem;
    color: var(--text-dim);
    min-width: 18px;
  }

  .nav-title { font-family: var(--serif); font-weight: 500; }

  /* Tags */

  .tag-section {
    padding: 16px 24px;
    border-top: 1px solid var(--border);
    margin-top: auto;
  }

  .tag-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 8px;
  }

  .tag-pill {
    font-family: var(--mono);
    font-size: 0.6rem;
    letter-spacing: 0.04em;
    padding: 3px 10px;
    border-radius: 20px;
    border: 1px solid var(--border);
    background: var(--tag-bg);
    color: var(--tag-text);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tag-pill:hover { border-color: var(--border-light); color: var(--text-bright); }
  .tag-pill.active {
    background: var(--tag-active-bg);
    border-color: var(--accent-dim);
    color: var(--tag-active-text);
  }

  /* Harvest footer */

  .harvest-section {
    padding: 16px 24px 24px;
    border-top: 1px solid var(--border);
  }

  .harvest-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 8px;
  }

  .harvest-item {
    font-family: var(--mono);
    font-size: 0.6rem;
    display: flex;
    justify-content: space-between;
    padding: 2px 0;
    color: var(--text-dim);
  }

  .harvest-item .status-ok { color: var(--success); }
  .harvest-item .status-err { color: var(--error); }
  .harvest-item .status-skip { color: var(--skip); }

  /* ── Main Content ────────────────────────── */

  .main {
    margin-left: var(--sidebar-w);
    flex: 1;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .content-area {
    max-width: 820px;
    width: 100%;
    margin: 0 auto;
    padding: 48px 48px 80px;
    flex: 1;
  }

  .page-section {
    display: none;
    animation: fadeUp 0.3s ease both;
  }

  .page-section.active { display: block; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* Landing */

  .landing { animation: fadeUp 0.4s ease both; }
  .landing.hidden { display: none; }

  .landing h1 {
    font-family: var(--serif);
    font-size: 2.2rem;
    font-weight: 300;
    color: var(--text-bright);
    margin-bottom: 8px;
    letter-spacing: -0.02em;
  }

  .landing-sub {
    font-family: var(--mono);
    font-size: 0.7rem;
    color: var(--text-dim);
    letter-spacing: 0.04em;
    margin-bottom: 40px;
  }

  .landing-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 12px;
    margin-bottom: 40px;
  }

  .landing-card {
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    cursor: pointer;
    transition: all 0.2s ease;
    text-decoration: none;
    color: inherit;
    display: block;
  }

  .landing-card:hover {
    border-color: var(--accent-dim);
    background: var(--bg-hover);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px #0006;
  }

  .landing-card-order {
    font-family: var(--mono);
    font-size: 0.6rem;
    color: var(--accent);
    letter-spacing: 0.1em;
    margin-bottom: 6px;
  }

  .landing-card-title {
    font-family: var(--serif);
    font-size: 1.05rem;
    font-weight: 500;
    color: var(--text-bright);
    margin-bottom: 8px;
  }

  .landing-card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .landing-card-tags .tag-pill { pointer-events: none; font-size: 0.55rem; padding: 2px 7px; }

  .harvest-table-wrap { margin-top: 20px; }

  /* ── Typography ──────────────────────────── */

  .content-area h1 {
    font-family: var(--serif);
    font-size: 1.9rem;
    font-weight: 400;
    color: var(--text-bright);
    margin: 0 0 24px;
    letter-spacing: -0.02em;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border);
  }

  .content-area h2 {
    font-family: var(--mono);
    font-size: 0.75rem;
    font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 40px 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .content-area h3 {
    font-family: var(--serif);
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-bright);
    margin: 28px 0 12px;
  }

  .content-area h4 {
    font-family: var(--serif);
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    margin: 20px 0 8px;
  }

  .content-area p { margin: 0 0 14px; }

  .content-area .content-img {
    max-width: 100%;
    height: auto;
    border-radius: 6px;
    border: 1px solid var(--border);
    margin: 16px 0;
    display: block;
    background: #fff;
    padding: 12px;
  }

  .diagram-link { display: block; cursor: pointer; transition: opacity 0.15s; }
  .diagram-link:hover { opacity: 0.85; }
  .diagram-link:hover .content-img { border-color: var(--accent); }

  .content-area strong { color: var(--text-bright); font-weight: 600; }
  .content-area em { font-style: italic; color: var(--text); }

  .content-area a.wiki-link {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid var(--accent-dim);
    transition: border-color 0.15s;
  }
  .content-area a.wiki-link:hover { border-color: var(--accent); }

  .content-area a.ext-link {
    color: var(--tag-text);
    text-decoration: none;
    border-bottom: 1px dotted var(--border-light);
  }
  .content-area a.ext-link:hover { color: var(--text-bright); }

  /* Tables */

  .table-wrap {
    overflow-x: auto;
    margin: 16px 0;
    border-radius: 6px;
    border: 1px solid var(--border);
  }

  .content-area table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.85rem;
  }

  .content-area th {
    font-family: var(--mono);
    font-size: 0.65rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-dim);
    background: var(--bg-surface);
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    font-weight: 500;
  }

  .content-area td {
    padding: 8px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--text);
  }

  .content-area tr:last-child td { border-bottom: none; }
  .content-area tr:hover td { background: var(--bg-hover); }

  /* Code */

  .code-block {
    background: var(--bg-deep);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 16px 20px;
    overflow-x: auto;
    margin: 16px 0;
    font-family: var(--mono);
    font-size: 0.78rem;
    line-height: 1.6;
    color: var(--text);
  }

  code.inline {
    font-family: var(--mono);
    font-size: 0.82em;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    padding: 1px 6px;
    border-radius: 3px;
    color: var(--text-bright);
  }

  /* Lists */

  .content-list {
    list-style: none;
    padding: 0;
    margin: 12px 0;
  }

  .content-list li {
    position: relative;
    padding: 4px 0 4px 20px;
    color: var(--text);
  }

  .content-list li::before {
    content: "\\2014";
    position: absolute;
    left: 0;
    color: var(--accent-dim);
    font-family: var(--mono);
    font-size: 0.8em;
  }

  /* Divider */

  .divider {
    border: none;
    border-top: 1px solid var(--border);
    margin: 32px 0;
  }

  /* Full-page iframe sections (e.g. test intent map) */


  .content-area:has(.page-section-iframe.active) {
    max-width: none;
    padding: 0;
  }

  .page-section-iframe iframe {
    width: 100%;
    height: 100vh;
    border: none;
    background: #fff;
  }













  /* Status indicators */
  .status-ok { color: var(--success); }
  .status-err { color: var(--error); }
  .status-skip { color: var(--skip); }

  /* ── Responsive ──────────────────────────── */

  .menu-toggle {
    display: none;
    position: fixed;
    top: 16px;
    left: 16px;
    z-index: 20;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 18px;
    cursor: pointer;
    align-items: center;
    justify-content: center;
  }

  @media (max-width: 768px) {
    .sidebar {
      transform: translateX(-100%);
      transition: transform 0.25s ease;
    }
    .sidebar.open { transform: translateX(0); }
    .main { margin-left: 0; }
    .menu-toggle { display: flex; }
    .content-area { padding: 60px 24px 40px; }
  }

  /* ── Grain overlay ───────────────────────── */

  body::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    opacity: 0.025;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 256px;
  }
</style>
</head>
<body>

<button class="menu-toggle" id="menuToggle">\u2630</button>

<aside class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <div class="sidebar-brand">archdoc</div>
    <div class="sidebar-repo">${escapeHtml(manifest.repo)}</div>
    <div class="sidebar-meta">${manifest.generatedAt.slice(0, 10)}</div>
  </div>

  <div class="nav-section-label">Pages</div>
  <ul class="nav-list" id="navList">
    ${navItems}
  </ul>${htmlPages.length > 0 ? `

  <div class="nav-section-label">Interactive</div>
  <ul class="nav-list" id="navListHtml">
    ${htmlNavItems}
  </ul>` : ""}
${svgPages.length > 0 ? `

  <div class="nav-section-label">Diagrams</div>
  <ul class="nav-list" id="navListSvg">
    ${svgNavItems}
  </ul>` : ""}

  <div class="tag-section">
    <div class="nav-section-label" style="padding:0 0 4px">Filter by tag</div>
    <div class="tag-cloud" id="tagCloud">
      ${tagPills}
    </div>
  </div>

  <div class="harvest-section">
    <div class="nav-section-label" style="padding:0 0 4px">Harvest</div>
    <div class="harvest-list">
      ${manifest.harvest.map((h) => {
        const cls = h.status === "success" ? "status-ok" : h.status === "error" ? "status-err" : "status-skip";
        return `<div class="harvest-item"><span>${escapeHtml(h.id)}</span><span class="${cls}">${h.status}${h.durationMs != null ? ` ${h.durationMs}ms` : ""}</span></div>`;
      }).join("\n")}
    </div>
  </div>
</aside>

<main class="main">
  <div class="content-area" id="contentArea">

    <div class="landing" id="landing">
      <h1>${escapeHtml(manifest.repo)}</h1>
      <div class="landing-sub">${escapeHtml(manifest.targetPath)}</div>

      <div class="landing-grid" id="landingGrid">
        ${pages.map((p) => `
          <a href="#" class="landing-card" data-page="${p.slug}">
            <div class="landing-card-order">${String(p.order).padStart(2, "0")}</div>
            <div class="landing-card-title">${escapeHtml(p.title)}</div>
            <div class="landing-card-tags">${p.tags.map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join("")}</div>
          </a>
        `).join("\n")}
        ${htmlPages.map((hp) => `
          <a href="${hp.file}" class="landing-card">
            <div class="landing-card-order">${String(hp.order).padStart(2, "0")}</div>
            <div class="landing-card-title">${escapeHtml(hp.title)}</div>
            <div class="landing-card-tags"><span class="tag-pill">interactive</span></div>
          </a>
        `).join("\n")}
      </div>

      ${manifest.harvest.length > 0 ? `
      <div class="harvest-table-wrap">
        <h2>Harvest Results</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tool</th><th>Status</th><th>Duration</th></tr></thead>
            <tbody>${harvestRows}</tbody>
          </table>
        </div>
      </div>` : ""}
    </div>

    ${pageSections}

  </div>
</main>

<script>
(function() {
  const sections = document.querySelectorAll('.page-section');
  const navLinks = document.querySelectorAll('.nav-link');
  const tagPills = document.querySelectorAll('.tag-pill');
  const landing = document.getElementById('landing');
  const landingCards = document.querySelectorAll('.landing-card');
  const sidebar = document.getElementById('sidebar');
  const menuToggle = document.getElementById('menuToggle');
  const activeTags = new Set();

  function showPage(slug) {
    landing.classList.add('hidden');
    sections.forEach(s => {
      s.classList.remove('active');
      if (s.dataset.page === slug) s.classList.add('active');
    });
    navLinks.forEach(l => {
      l.classList.remove('active');
      if (l.dataset.page === slug) l.classList.add('active');
    });
    window.scrollTo(0, 0);
    if (window.innerWidth <= 768) sidebar.classList.remove('open');
  }

  function showLanding() {
    sections.forEach(s => s.classList.remove('active'));
    navLinks.forEach(l => l.classList.remove('active'));
    landing.classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function applyTagFilter() {
    if (activeTags.size === 0) {
      navLinks.forEach(l => l.classList.remove('dimmed'));
      landingCards.forEach(c => { c.style.display = ''; });
      return;
    }
    navLinks.forEach(l => {
      const tags = JSON.parse(l.dataset.tags || '[]');
      const match = tags.some(t => activeTags.has(t));
      l.classList.toggle('dimmed', !match);
    });
    landingCards.forEach(c => {
      const slug = c.dataset.page;
      const section = document.querySelector('.page-section[data-page="' + slug + '"]');
      if (!section) return;
      const tags = JSON.parse(section.dataset.tags || '[]');
      const match = tags.some(t => activeTags.has(t));
      c.style.display = match ? '' : 'none';
    });
  }

  // Nav clicks
  navLinks.forEach(link => {
    if (!link.dataset.page) return; // standalone page — use normal navigation
    link.addEventListener('click', e => { e.preventDefault(); showPage(link.dataset.page); });
  });

  // Landing card clicks
  landingCards.forEach(card => {
    if (!card.dataset.page) return; // standalone page — use normal navigation
    card.addEventListener('click', e => { e.preventDefault(); showPage(card.dataset.page); });
  });

  // Wiki link clicks
  document.addEventListener('click', e => {
    const wl = e.target.closest('.wiki-link');
    if (wl) { e.preventDefault(); showPage(wl.dataset.page); }
  });

  // Brand click -> landing
  document.querySelector('.sidebar-brand').addEventListener('click', showLanding);
  document.querySelector('.sidebar-brand').style.cursor = 'pointer';

  // Tag filtering
  tagPills.forEach(pill => {
    pill.addEventListener('click', () => {
      const tag = pill.dataset.tag;
      if (activeTags.has(tag)) { activeTags.delete(tag); pill.classList.remove('active'); }
      else { activeTags.add(tag); pill.classList.add('active'); }
      applyTagFilter();
    });
  });

  // Mobile menu
  menuToggle.addEventListener('click', () => sidebar.classList.toggle('open'));

  // Handle hash navigation
  if (location.hash) {
    const slug = location.hash.slice(1);
    if (slug) showPage(slug);
  }
})();
</script>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: false, theme: 'dark' });

  // Re-render mermaid when pages switch
  const observer = new MutationObserver(() => {
    const visible = document.querySelectorAll('.page-section.active .mermaid');
    if (visible.length) mermaid.run({ nodes: visible });
  });
  observer.observe(document.getElementById('contentArea'), { childList: true, subtree: true, attributes: true });

  // Initial render
  setTimeout(() => {
    const visible = document.querySelectorAll('.page-section.active .mermaid');
    if (visible.length) mermaid.run({ nodes: visible });
  }, 100);
</script>
<script>
  // Fit iframe: inject styles to constrain table width, then match height
  document.querySelectorAll('.page-section-iframe iframe').forEach(iframe => {
    iframe.addEventListener('load', () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        // Inject a style that forces content to fit the iframe width
        const s = doc.createElement('style');
        s.textContent = 'body { overflow-x: hidden !important; } table { table-layout: fixed !important; width: 100% !important; word-wrap: break-word; }';
        doc.head.appendChild(s);
        // Match iframe height to content
        const fit = () => {
          const h = doc.documentElement.scrollHeight;
          if (h > 0) iframe.style.height = h + 'px';
        };
        fit();
        setTimeout(fit, 500);
        window.addEventListener('resize', fit);
      } catch(e) { /* cross-origin */ }
    });
  });
</script>

</body>
</html>`;
}
