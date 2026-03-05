/**
 * Wraps an SVG diagram in a standalone HTML page with a back-to-site header.
 * Uses browser history so the back link returns to the exact page you came from.
 */
export function wrapSvgAsPage(svgContent: string, title: string, repo: string): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="UTF-8">',
    `<title>${esc(title)} \u2014 ${esc(repo)} archdoc</title>`,
    "<style>",
    "  * { box-sizing: border-box; margin: 0; padding: 0; }",
    "  body { background: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; }",
    "  .header { background: #1a1d23; color: #c8ccd4; padding: 10px 20px; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #2a2f3a; font-size: 13px; }",
    "  .header a { color: #d4915e; text-decoration: none; font-weight: 600; cursor: pointer; }",
    "  .header .label { color: #6b7280; }",
    "  .diagram-wrap { padding: 20px; text-align: center; overflow: auto; }",
    "  .diagram-wrap svg { max-width: 100%; height: auto; }",
    "</style>",
    "</head>",
    "<body>",
    '<div class="header">',
    `  <a onclick="history.back()" id="backLink">\u2190 Back</a>`,
    `  <span>${esc(title)}</span>`,
    '  <span class="label">archdoc</span>',
    "</div>",
    "<script>",
    "  // If opened directly (no history), fall back to index",
    "  if (history.length <= 1) document.getElementById('backLink').href = 'index.html';",
    "</script>",
    '<div class="diagram-wrap">',
    svgContent,
    "</div>",
    "</body>",
    "</html>",
  ].join("\n");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
