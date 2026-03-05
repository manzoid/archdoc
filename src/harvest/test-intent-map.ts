import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { TestCensusHarvest } from "../types/harvest.js";
import type { HarvestToolDescriptor } from "../types/tool.js";
import { isBinaryAvailable } from "../util/cli-check.js";

const execFileAsync = promisify(execFile);

export const testIntentMapTool: HarvestToolDescriptor<TestCensusHarvest> = {
  id: "test-intent-map",
  name: "Test Census (test-intent-map)",
  requiredBinary: "test-intent-map",
  checkAvailability: () => isBinaryAvailable("test-intent-map"),
  run: async (targetPath) => {
    const jsonPath = join(tmpdir(), `tim-${Date.now()}.json`);

    await execFileAsync("test-intent-map", [targetPath, "--json", jsonPath], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120_000,
    });

    const raw = await readFile(jsonPath, "utf-8");
    const data = JSON.parse(raw) as TestCensusHarvest;

    await unlink(jsonPath).catch(() => {});

    return data;
  },
};
