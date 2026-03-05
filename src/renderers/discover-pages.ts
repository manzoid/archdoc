import { readFile, readdir } from "fs/promises";
import { join } from "path";
import type { WikiManifest, ManifestPage } from "../types/wiki.js";

/**
 * Discover all wiki pages in outputDir by scanning .md files and merging
 * with the manifest. Enrich-produced pages not in the manifest are included
 * automatically by parsing their YAML frontmatter.
 */
export async function discoverPages(outputDir: string, manifest: WikiManifest): Promise<ManifestPage[]> {
  const knownSlugs = new Set(manifest.pages.map((p) => p.slug));
  const discovered: ManifestPage[] = [...manifest.pages];

  const files = await readdir(outputDir);
  for (const file of files) {
    if (!file.endsWith(".md") || file === "index.md") continue;
    const slug = file.replace(/\.md$/, "");
    if (knownSlugs.has(slug)) continue;

    // Parse frontmatter from unknown .md file
    const content = await readFile(join(outputDir, file), "utf-8");
    const fm = parseFrontmatter(content);
    if (!fm) continue;

    discovered.push({
      title: fm.title || slug,
      slug,
      file,
      order: fm.order ?? 99,
      tags: fm.tags ?? [],
      crossRefs: fm.crossRefs ?? [],
    });
    knownSlugs.add(slug);
  }

  return discovered.sort((a, b) => a.order - b.order);
}

interface ParsedFrontmatter {
  title?: string;
  slug?: string;
  order?: number;
  tags?: string[];
  crossRefs?: string[];
}

function parseFrontmatter(content: string): ParsedFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const fm: ParsedFrontmatter = {};
  const lines = match[1].split("\n");
  for (const line of lines) {
    const kv = line.match(/^(\w[\w_]*):\s*(.+)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    if (key === "title") fm.title = val.replace(/^"(.*)"$/, "$1");
    if (key === "slug") fm.slug = val.trim();
    if (key === "order") fm.order = parseInt(val, 10);
    if (key === "tags") fm.tags = parseYamlArray(val);
    if (key === "cross_refs") fm.crossRefs = parseYamlArray(val);
  }
  return fm;
}

function parseYamlArray(val: string): string[] {
  const match = val.match(/\[([^\]]*)\]/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}
