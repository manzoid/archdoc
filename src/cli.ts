#!/usr/bin/env node

import { Command } from "commander";
import { resolve } from "path";
import { runPipeline } from "./pipeline/orchestrator.js";
import { listEnrichSteps, generateStepPrompt, generateAllStepsPrompt } from "./prompts/enrich.js";
import type { ArchdocConfig, OutputFormat, PipelinePhase } from "./types/config.js";
import { DEFAULT_CONFIG } from "./types/config.js";

const program = new Command();

program
  .name("archdoc")
  .description("AI-powered codebase wiki generator")
  .version("0.1.0");

// Main command: generate wiki
program
  .command("generate", { isDefault: true })
  .description("Generate wiki pages from codebase analysis")
  .argument("<target>", "Path to the codebase to document")
  .option("--output <format>", "Output format: site or markdown", "markdown")
  .option("--only <phase>", "Run only a specific phase: harvest, generate, render, assemble")
  .option("--pages <pages>", "Comma-separated list of pages to generate")
  .option("--churn-since <date>", "Start date for churn analysis (YYYY-MM-DD)")
  .option("--skip-tools <tools>", "Comma-separated list of tool IDs to skip")
  .action(async (target: string, options) => {
    const targetPath = resolve(target);
    const config: ArchdocConfig = {
      ...DEFAULT_CONFIG,
      targetPath,
      output: options.output as OutputFormat,
      only: options.only as PipelinePhase | undefined,
      pages: options.pages ? options.pages.split(",").map((p: string) => p.trim()) : undefined,
      churnSince: options.churnSince,
      skipTools: options.skipTools ? options.skipTools.split(",").map((t: string) => t.trim()) : undefined,
    };
    try {
      await runPipeline(config);
    } catch (err) {
      console.error("archdoc failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

// Enrich command: output AI prompt for the running agent
program
  .command("enrich")
  .description("Output AI enrichment prompts — pipe to your coding agent or copy-paste")
  .option("--harvest-dir <dir>", "Path to harvest data", "harvest")
  .option("--output-dir <dir>", "Path to generated pages", "archdoc-output")
  .option("--step <number>", "Output prompt for a specific step number")
  .option("--all", "Output all steps as one sequenced prompt")
  .action(async (options) => {
    try {
      const harvestDir = resolve(options.harvestDir);
      const outputDir = resolve(options.outputDir);

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
        // No flags — list available steps
        console.log(listEnrichSteps());
      }
    } catch (err) {
      console.error("archdoc enrich failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  });

program.parse();
