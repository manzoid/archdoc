import { execFile } from "child_process";
import { promisify } from "util";
import type { CodeStatsHarvest, LanguageStat } from "../types/harvest.js";
import type { HarvestToolDescriptor } from "../types/tool.js";
import { isBinaryAvailable } from "../util/cli-check.js";

const execFileAsync = promisify(execFile);

export const sccTool: HarvestToolDescriptor<CodeStatsHarvest> = {
  id: "scc",
  name: "Code Stats (scc)",
  requiredBinary: "scc",
  checkAvailability: () => isBinaryAvailable("scc"),
  run: async (targetPath) => {
    const { stdout } = await execFileAsync(
      "scc",
      ["--format", "json", "--no-cocomo", targetPath],
      { maxBuffer: 10 * 1024 * 1024 }
    );

    const raw: LanguageStat[] = JSON.parse(stdout);

    const languages = raw
      .filter((lang) => lang.Code > 0)
      .sort((a, b) => b.Code - a.Code);

    const totalFiles = languages.reduce((sum, l) => sum + l.Count, 0);
    const totalLines = languages.reduce((sum, l) => sum + l.Lines, 0);
    const totalCode = languages.reduce((sum, l) => sum + l.Code, 0);
    const totalComment = languages.reduce((sum, l) => sum + l.Comment, 0);
    const totalBlank = languages.reduce((sum, l) => sum + l.Blank, 0);
    const totalComplexity = languages.reduce((sum, l) => sum + l.Complexity, 0);

    return { languages, totalFiles, totalLines, totalCode, totalComment, totalBlank, totalComplexity };
  },
};
