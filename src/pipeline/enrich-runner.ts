import { readFile } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import chalk from "chalk";
import type { HarvestBag } from "../types/tool.js";
import { enrichSteps } from "../registry.js";

export interface EnrichRunnerOptions {
  model?: string;
}

export async function runEnrich(
  harvestDir: string,
  outputDir: string,
  options: EnrichRunnerOptions = {}
): Promise<void> {
  const bag = JSON.parse(
    await readFile(join(harvestDir, "harvest-bag.json"), "utf-8")
  ) as HarvestBag;

  const sorted = [...enrichSteps].sort((a, b) => a.step - b.step);
  const modelArgs = options.model ? `--model ${options.model}` : "";

  for (const step of sorted) {
    console.log(chalk.cyan(`  Step ${step.step}: ${step.name}`));

    const prompt = await step.generate(bag, outputDir);

    try {
      const env = { ...process.env };
      delete env.CLAUDECODE;
      execSync(`claude -p --dangerously-skip-permissions ${modelArgs} /dev/stdin`, {
        input: prompt,
        stdio: ["pipe", "inherit", "inherit"],
        timeout: 10 * 60 * 1000, // 10 minutes per step
        maxBuffer: 10 * 1024 * 1024,
        env,
      });
      console.log(chalk.green(`  ✓ ${step.name}\n`));
    } catch (e: any) {
      console.error(
        chalk.red(`  ✗ ${step.name} failed: ${e.message}`)
      );
      throw e;
    }
  }
}
