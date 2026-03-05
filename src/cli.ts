#!/usr/bin/env node

import { Command } from "commander";
import { resolve, basename } from "path";
import { readdir, stat, readFile, writeFile, mkdir } from "fs/promises";
import { homedir } from "os";
import { runPipeline } from "./pipeline/orchestrator.js";

import { listEnrichSteps, generateStepPrompt, generateAllStepsPrompt } from "./prompts/enrich.js";
import { renderBareHtml } from "./renderers/html-bare.js";
import { renderSiteHtml } from "./renderers/html-site.js";
import { renderDiagrams } from "./renderers/diagrams.js";
import type { ArchdocConfig, OutputFormat, PipelinePhase } from "./types/config.js";
import { defaultDirs } from "./types/config.js";

const program = new Command();

program
  .name("archdoc")
  .description("AI-powered codebase wiki generator")
  .version("0.2.2")
  .action(() => {
    // No subcommand — print full usage instructions for an AI agent
    console.log(`archdoc — AI-powered codebase wiki generator

To document a codebase, run these 3 phases in order:

1. archdoc generate /path/to/repo
   Harvests codebase data and generates skeleton wiki pages. Takes seconds.

2. Enrich steps 1-5 — launch each as a background task, all 5 are independent:
   env -u CLAUDECODE archdoc enrich /path/to/repo --step N | claude --dangerously-skip-permissions -p -
   where N is 1 through 5. Each takes 5-20 minutes. Wait for all to complete.
   NOTE: env -u CLAUDECODE is required when running from within a Claude Code session.

3. archdoc render /path/to/repo --format site
   Builds a browsable HTML site from the enriched pages. Takes seconds.

Output lives in ~/archdoc-runs/. The site URL is printed at the end.

Run 'archdoc init' to install dependencies and register with Claude Code.
Run 'archdoc --help' for all commands and options.`);
  });

/**
 * Derive the slug prefix for a target path (matches defaultDirs logic).
 */
function repoSlug(targetPath: string): string {
  const parts = targetPath.replace(/\\/g, "/").split("/");
  const ghIdx = parts.indexOf("github.com");
  if (ghIdx >= 0 && parts.length > ghIdx + 2) {
    return parts.slice(ghIdx + 1).join("-");
  }
  return basename(targetPath);
}

/**
 * Find the most recent archdoc run for a given repo under /tmp/archdoc/.
 * Returns { outputDir, harvestDir } or null if none found.
 */
async function findLatestRun(targetPath: string): Promise<{ baseDir: string; outputDir: string; harvestDir: string } | null> {
  const slug = repoSlug(targetPath);
  const archdocTmp = `${homedir()}/archdoc-runs`;
  let entries: string[];
  try {
    entries = await readdir(archdocTmp);
  } catch {
    return null;
  }

  const matching = entries
    .filter((e) => e.startsWith(`${slug}-`))
    .sort()
    .reverse();

  for (const dir of matching) {
    const baseDir = `${archdocTmp}/${dir}`;
    const s = await stat(baseDir).catch(() => null);
    if (s?.isDirectory()) {
      return {
        baseDir,
        outputDir: `${baseDir}/output`,
        harvestDir: `${baseDir}/harvest`,
      };
    }
  }
  return null;
}

// Main command: generate wiki
program
  .command("generate")
  .description("Generate wiki pages from codebase analysis")
  .argument("<target>", "Path to the codebase to document")
  .option("--output <format>", "Output format: site or markdown", "markdown")
  .option("--output-dir <dir>", "Override output directory")
  .option("--harvest-dir <dir>", "Override harvest directory")
  .option("--only <phase>", "Run only a specific phase: harvest, generate, render, assemble")
  .option("--pages <pages>", "Comma-separated list of pages to generate")
  .option("--churn-since <date>", "Start date for churn analysis (YYYY-MM-DD)")
  .option("--skip-tools <tools>", "Comma-separated list of tool IDs to skip")
  .action(async (target: string, options) => {
    const targetPath = resolve(target);
    const dirs = defaultDirs(targetPath);
    const config: ArchdocConfig = {
      targetPath,
      output: options.output as OutputFormat,
      outputDir: options.outputDir ? resolve(options.outputDir) : dirs.outputDir,
      harvestDir: options.harvestDir ? resolve(options.harvestDir) : dirs.harvestDir,
      only: options.only as PipelinePhase | undefined,
      pages: options.pages ? options.pages.split(",").map((p: string) => p.trim()) : undefined,
      churnSince: options.churnSince,
      skipTools: options.skipTools ? options.skipTools.split(",").map((t: string) => t.trim()) : undefined,
    };
    try {
      await runPipeline(config);
      console.log(`Run directory: ${dirs.baseDir}`);
    } catch (err) {
      console.error("archdoc failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Enrich command: output AI prompt for the running agent
program
  .command("enrich")
  .description("Output AI enrichment prompts — pipe to your coding agent or copy-paste")
  .argument("<target>", "Path to the codebase (locates latest run under /tmp/archdoc/)")
  .option("--harvest-dir <dir>", "Override harvest directory")
  .option("--output-dir <dir>", "Override output directory")
  .option("--step <number>", "Output prompt for a specific step number")
  .option("--all", "Output all steps as one sequenced prompt")
  .action(async (target: string, options) => {
    try {
      const targetPath = resolve(target);
      const latest = await findLatestRun(targetPath);
      const harvestDir = options.harvestDir ? resolve(options.harvestDir) : latest?.harvestDir;
      const outputDir = options.outputDir ? resolve(options.outputDir) : latest?.outputDir;

      if (!harvestDir || !outputDir) {
        console.error(`No archdoc run found for ${basename(targetPath)}. Run 'archdoc generate' first.`);
        process.exit(1);
      }

      if (options.step) {
        const stepNum = parseInt(options.step, 10);
        if (isNaN(stepNum)) {
          console.error("--step must be a number");
          process.exit(1);
        }
        const prompt = await generateStepPrompt(harvestDir, outputDir, stepNum);
        console.log(prompt);
      } else if (options.all) {
        const prompt = await generateAllStepsPrompt(harvestDir, outputDir);
        console.log(prompt);
      } else {
        console.log(`Using run: ${latest?.baseDir ?? "(custom dirs)"}\n`);
        console.log(listEnrichSteps());
      }
    } catch (err) {
      console.error("archdoc enrich failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Render command: produce HTML from assembled output
program
  .command("render")
  .description("Render assembled wiki pages to HTML")
  .argument("<target>", "Path to the codebase (locates latest run under /tmp/archdoc/)")
  .option("--output-dir <dir>", "Override output directory containing manifest.json")
  .option("--format <format>", "Render format: bare or site", "bare")
  .action(async (target: string, options) => {
    try {
      const targetPath = resolve(target);
      const latest = await findLatestRun(targetPath);
      const outputDir = options.outputDir ? resolve(options.outputDir) : latest?.outputDir;

      if (!outputDir) {
        console.error(`No archdoc run found for ${basename(targetPath)}. Run 'archdoc generate' first.`);
        process.exit(1);
      }

      console.log(`Using run: ${latest?.baseDir ?? "(custom dir)"}`);

      // Render D2 diagrams first (produces SVGs that HTML renderers reference)
      const diagResults = await renderDiagrams(outputDir);
      if (diagResults.length > 0) {
        console.log(`  ${diagResults.filter((d) => d.status === "success").length} diagram(s) rendered\n`);
      }

      if (options.format === "bare") {
        console.log("Rendering bare HTML site...\n");
        await renderBareHtml(outputDir);
        console.log(`\nSite written to ${outputDir}/site/`);
      } else if (options.format === "site") {
        console.log("Rendering interactive site...\n");
        await renderSiteHtml(outputDir);
        console.log(`\nSite written to ${outputDir}/site-fancy/`);
      } else {
        console.error(`Unknown render format: ${options.format}. Use 'bare' or 'site'.`);
        process.exit(1);
      }
    } catch (err) {
      console.error("archdoc render failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Init command: install dependencies and register in CLAUDE.md
program
  .command("init")
  .description("Install dependencies and add archdoc instructions to ~/.claude/CLAUDE.md")
  .action(async () => {
    const { execSync } = await import("child_process");

    function isAvailable(cmd: string): boolean {
      try {
        execSync(`which ${cmd}`, { stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    }

    function npmInstall(pkg: string): boolean {
      try {
        console.log(`  Installing ${pkg}...`);
        execSync(`npm i -g ${pkg}`, { stdio: "inherit" });
        return true;
      } catch {
        console.error(`  ✗ Failed to install ${pkg}`);
        return false;
      }
    }

    // ── Check and install dependencies ──

    console.log("Checking dependencies...\n");
    let allGood = true;

    // Brew binaries
    const brewDeps = [
      { cmd: "scc", desc: "code statistics" },
      { cmd: "d2", desc: "architecture diagrams" },
    ];
    for (const dep of brewDeps) {
      if (isAvailable(dep.cmd)) {
        console.log(`  ✓ ${dep.cmd} (${dep.desc})`);
      } else {
        console.log(`  ✗ ${dep.cmd} not found — install with: brew install ${dep.cmd}`);
        allGood = false;
      }
    }

    // npm global packages
    const npmDeps = [
      { cmd: "repo-feature-check", pkg: "@manzoid2/repo-feature-check", desc: "symbol census" },
      { cmd: "test-intent-map", pkg: "@manzoid2/test-intent-map", desc: "test metadata extraction" },
    ];
    for (const dep of npmDeps) {
      if (isAvailable(dep.cmd)) {
        console.log(`  ✓ ${dep.cmd} (${dep.desc})`);
      } else {
        if (!npmInstall(dep.pkg)) {
          allGood = false;
        } else {
          console.log(`  ✓ ${dep.cmd} (${dep.desc})`);
        }
      }
    }

    if (!allGood) {
      console.log("\nSome dependencies are missing. Install them and re-run archdoc init.");
    }

    // ── Register in CLAUDE.md ──

    console.log("");
    const claudeDir = `${homedir()}/.claude`;
    const claudeMd = `${claudeDir}/CLAUDE.md`;
    const marker = "## archdoc";

    const block = `## archdoc
Globally installed CLI (\`npm i -g @manzoid2/archdoc\`) for generating AI-powered codebase wikis.
Run \`archdoc\` with no arguments to get usage instructions — then follow those instructions.

`;

    try {
      await mkdir(claudeDir, { recursive: true });

      let existing = "";
      try {
        existing = await readFile(claudeMd, "utf-8");
      } catch {
        // file doesn't exist yet
      }

      if (existing.includes(marker)) {
        // Replace existing archdoc block — find from marker to next ## or end of file
        const markerIdx = existing.indexOf(marker);
        const afterMarker = existing.indexOf("\n## ", markerIdx + marker.length);
        const before = existing.slice(0, markerIdx);
        const after = afterMarker >= 0 ? existing.slice(afterMarker + 1) : "";
        await writeFile(claudeMd, before + block + after, "utf-8");
        console.log("✓ Updated archdoc instructions in ~/.claude/CLAUDE.md");
      } else {
        const separator = existing.length > 0 && !existing.endsWith("\n\n") ? "\n" : "";
        await writeFile(claudeMd, existing + separator + block, "utf-8");
        console.log("✓ Added archdoc instructions to ~/.claude/CLAUDE.md");
      }

      // Always print usage so the current Claude session can act on it immediately
      console.log("\n" + block);
    } catch (err) {
      console.error("archdoc init failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
