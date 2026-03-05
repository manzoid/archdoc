import { writeFile } from "fs/promises";
import { join } from "path";
import chalk from "chalk";
import type { ArchdocConfig } from "../types/config.js";
import type { HarvestBag, HarvestToolDescriptor, ToolResult, HarvestContext } from "../types/tool.js";
import { harvestTools } from "../registry.js";

export async function runHarvest(config: ArchdocConfig, harvestDir: string): Promise<HarvestBag> {
  const context: HarvestContext = { churnSince: config.churnSince };
  const skip = new Set(config.skipTools ?? []);

  // 1. Check availability of all tools
  const availability = await Promise.all(
    harvestTools.map(async (tool) => ({
      tool,
      available: skip.has(tool.id) ? false : await tool.checkAvailability(),
      skippedByConfig: skip.has(tool.id),
    }))
  );

  for (const { tool, available, skippedByConfig } of availability) {
    if (skippedByConfig) {
      console.log(chalk.yellow(`  ⚠ ${tool.name} — skipped (config)`));
    } else if (!available) {
      console.log(chalk.yellow(`  ⚠ ${tool.name} — skipped (${tool.requiredBinary ?? tool.id} not found)`));
    }
  }

  const runnableTools = availability
    .filter((a) => a.available && !a.skippedByConfig)
    .map((a) => a.tool);

  // 2. Execute in dependency waves
  const results: Record<string, unknown> = {};
  const resultMeta: Record<string, ToolResult> = {};
  const completed = new Set<string>();

  // Mark unavailable/skipped tools
  for (const { tool, available, skippedByConfig } of availability) {
    if (!available || skippedByConfig) {
      const reason = skippedByConfig
        ? "skipped by config"
        : `${tool.requiredBinary ?? tool.id} not found`;
      resultMeta[tool.id] = { status: "skipped", toolId: tool.id, reason };
    }
  }

  // Run waves until all runnable tools complete
  let remaining = [...runnableTools];
  while (remaining.length > 0) {
    const ready = remaining.filter((t) =>
      !t.dependsOn || t.dependsOn.every((dep) => completed.has(dep))
    );

    if (ready.length === 0) {
      // Remaining tools have unresolvable deps — skip them
      for (const t of remaining) {
        const missing = (t.dependsOn ?? []).filter((d) => !completed.has(d));
        resultMeta[t.id] = {
          status: "skipped",
          toolId: t.id,
          reason: `unresolved dependencies: ${missing.join(", ")}`,
        };
        console.log(chalk.yellow(`  ⚠ ${t.name} — skipped (missing deps: ${missing.join(", ")})`));
      }
      break;
    }

    // Execute this wave in parallel
    await Promise.all(
      ready.map(async (tool) => {
        const start = Date.now();
        try {
          const data = await tool.run(config.targetPath, config, context);
          const durationMs = Date.now() - start;
          results[tool.id] = data;
          resultMeta[tool.id] = { status: "success", toolId: tool.id, data, durationMs };
          completed.add(tool.id);
          console.log(chalk.dim(`  ✓ ${tool.name} (${durationMs}ms)`));
        } catch (err) {
          resultMeta[tool.id] = {
            status: "error",
            toolId: tool.id,
            error: err instanceof Error ? err.message : String(err),
          };
          console.log(chalk.red(`  ✗ ${tool.name}: ${err instanceof Error ? err.message : err}`));
        }
      })
    );

    remaining = remaining.filter((t) => !completed.has(t.id) && !resultMeta[t.id]);
  }

  const bag: HarvestBag = {
    results,
    resultMeta,
    targetPath: config.targetPath,
    harvestedAt: new Date().toISOString(),
  };

  // Write per-tool JSON files + harvest-bag.json
  const writes: Promise<void>[] = [];
  for (const [toolId, data] of Object.entries(results)) {
    writes.push(writeFile(join(harvestDir, `${toolId}.json`), JSON.stringify(data, null, 2)));
  }
  writes.push(
    writeFile(join(harvestDir, "harvest-bag.json"), JSON.stringify(bag, null, 2))
  );
  await Promise.all(writes);

  return bag;
}
