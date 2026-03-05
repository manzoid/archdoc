export interface WikiPageFrontmatter {
  title: string;
  slug: string;
  order: number;
  tags: string[];
  crossRefs: string[];
}

export interface WikiPage {
  frontmatter: WikiPageFrontmatter;
  content: string;
}

export interface WikiOutput {
  pages: WikiPage[];
  generatedAt: string;
}

// ── Manifest ──────────────────────────────────────────────────

export interface ManifestPage {
  title: string;
  slug: string;
  file: string;
  order: number;
  tags: string[];
  crossRefs: string[];
}

export interface ManifestArtifact {
  id: string;
  file: string;
  type: "html" | "json" | "svg" | "png";
  description: string;
}

export interface ManifestHarvestTool {
  id: string;
  status: "success" | "skipped" | "error";
  file: string | null;
  durationMs: number | null;
}

export interface WikiManifest {
  version: 1;
  repo: string;
  targetPath: string;
  generatedAt: string;
  harvestedAt: string;
  pages: ManifestPage[];
  artifacts: ManifestArtifact[];
  harvest: ManifestHarvestTool[];
  tags: string[];
}
