import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type {
  Feature,
  FeatureCensusHarvest,
  RfcSymbol,
  RfcTotals,
  DirectoryGroup,
} from "../types/harvest.js";
import type { HarvestToolDescriptor } from "../types/tool.js";
import { isBinaryAvailable } from "../util/cli-check.js";

const execFileAsync = promisify(execFile);

interface RfcJson {
  repo: string;
  extractedAt: string;
  since: string | null;
  totals: RfcTotals;
  coverageRate: string;
  features: { id: string; name: string; category: string; functions: number; methods: number; classes: number; total: number }[];
  symbols: RfcSymbol[];
}

export const repoFeatureCheckTool: HarvestToolDescriptor<FeatureCensusHarvest> = {
  id: "repo-feature-check",
  name: "Feature Census (repo-feature-check)",
  requiredBinary: "repo-feature-check",
  checkAvailability: () => isBinaryAvailable("repo-feature-check"),
  run: async (targetPath, _config, context) => {
    const jsonPath = join(tmpdir(), `rfc-${Date.now()}.json`);

    const args = [targetPath, "--json", jsonPath];
    if (context.churnSince) args.push("--since", context.churnSince);

    await execFileAsync("repo-feature-check", args, {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120_000,
    });

    const raw = await readFile(jsonPath, "utf-8");
    const data: RfcJson = JSON.parse(raw);

    await unlink(jsonPath).catch(() => {});

    const dirGroups = groupByDirectory(data.symbols);

    const features: Feature[] = dirGroups.map((g) => ({
      name: g.directory,
      symbolCount: g.total,
      functions: g.functions,
      methods: g.methods,
      classes: g.classes,
      files: [...new Set(data.symbols.filter((s) => getTopDir(s.file) === g.directory).map((s) => s.file))],
    }));

    return {
      features,
      symbols: data.symbols,
      totals: data.totals,
      totalSymbols: data.totals.symbols,
      totalFeatures: features.length,
      directoryGroups: dirGroups,
    };
  },
};

function getTopDir(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 2) return parts[0];

  if (parts[0] === "backend" || parts[0] === "frontend") {
    if (parts.length >= 3) {
      if (parts[1] === "app" || parts[1] === "src" || parts[1] === "packages") {
        return parts.length >= 4 && (parts[1] === "packages" || parts[2] === "shared")
          ? parts.slice(0, 4).join("/")
          : parts.slice(0, 3).join("/");
      }
    }
    return parts.slice(0, 2).join("/");
  }

  return parts.slice(0, 2).join("/");
}

function groupByDirectory(symbols: RfcSymbol[]): DirectoryGroup[] {
  const groups = new Map<string, DirectoryGroup>();

  for (const sym of symbols) {
    const dir = getTopDir(sym.file);
    let group = groups.get(dir);
    if (!group) {
      group = { directory: dir, functions: 0, methods: 0, classes: 0, total: 0, sampleSymbols: [] };
      groups.set(dir, group);
    }

    group.total++;
    if (sym.kind === "function") group.functions++;
    else if (sym.kind === "method") group.methods++;
    else if (sym.kind === "class") group.classes++;

    if (group.sampleSymbols.length < 5) {
      group.sampleSymbols.push(sym.name);
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.total - a.total);
}
