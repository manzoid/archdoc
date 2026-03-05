import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import chalk from "chalk";
import { isBinaryAvailable } from "../util/cli-check.js";

const execFileAsync = promisify(execFile);

export interface DiagramResult {
  source: string;
  output: string;
  type: "d2" | "mermaid";
  status: "success" | "error";
  error?: string;
}

/**
 * Scan outputDir for .d2 files and render them to SVG using the d2 CLI.
 * Returns results for each diagram processed.
 */
export async function renderDiagrams(outputDir: string): Promise<DiagramResult[]> {
  const results: DiagramResult[] = [];

  const hasD2 = await isBinaryAvailable("d2");
  if (!hasD2) {
    console.log(chalk.yellow("  ⚠ d2 not found — skipping D2 diagram rendering"));
    console.log(chalk.yellow("    Install: brew install d2"));
    return results;
  }

  let files: string[];
  try {
    files = await readdir(outputDir);
  } catch {
    return results;
  }

  const d2Files = files.filter((f) => f.endsWith(".d2"));
  if (d2Files.length === 0) return results;

  for (const file of d2Files) {
    const inputPath = join(outputDir, file);
    const outputPath = join(outputDir, file.replace(/\.d2$/, ".svg"));
    const result: DiagramResult = {
      source: file,
      output: file.replace(/\.d2$/, ".svg"),
      type: "d2",
      status: "success",
    };

    try {
      await execFileAsync("d2", [
        "--theme", "0",
        "--layout", "elk",
        "--pad", "40",
        inputPath,
        outputPath,
      ], {
        timeout: 60_000,
      });
      console.log(chalk.dim(`  ✓ ${file} → ${result.output}`));
    } catch (err) {
      result.status = "error";
      result.error = err instanceof Error ? err.message : String(err);
      console.log(chalk.red(`  ✗ ${file}: ${result.error}`));
    }

    results.push(result);
  }

  return results;
}
