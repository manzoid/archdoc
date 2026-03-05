import { execFile } from "child_process";
import { promisify } from "util";
import type { FileChurn, GitAnalysisHarvest } from "../types/harvest.js";
import type { HarvestToolDescriptor } from "../types/tool.js";
import { isBinaryAvailable } from "../util/cli-check.js";

const execFileAsync = promisify(execFile);

export const gitAnalysisTool: HarvestToolDescriptor<GitAnalysisHarvest> = {
  id: "git-analysis",
  name: "Git Analysis",
  requiredBinary: "git",
  checkAvailability: () => isBinaryAvailable("git"),
  run: async (targetPath, _config, context) => {
    const [churnData, logStats, contributorCount] = await Promise.all([
      getFileChurn(targetPath, context.churnSince),
      getLogStats(targetPath),
      getContributorCount(targetPath),
    ]);

    return {
      topChurnFiles: churnData.slice(0, 50),
      ...logStats,
      contributors: contributorCount,
    };
  },
};

async function getFileChurn(targetPath: string, since?: string): Promise<FileChurn[]> {
  const args = ["log", "--format=", "--numstat"];
  if (since) args.push(`--since=${since}`);

  const { stdout } = await execFileAsync("git", args, {
    cwd: targetPath,
    maxBuffer: 50 * 1024 * 1024,
  });

  const churnMap = new Map<string, FileChurn>();

  for (const line of stdout.split("\n")) {
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!match) continue;

    const insertions = match[1] === "-" ? 0 : parseInt(match[1]);
    const deletions = match[2] === "-" ? 0 : parseInt(match[2]);
    const path = match[3];

    if (path.includes("=>")) continue;

    const existing = churnMap.get(path);
    if (existing) {
      existing.commits++;
      existing.insertions += insertions;
      existing.deletions += deletions;
    } else {
      churnMap.set(path, { path, commits: 1, insertions, deletions });
    }
  }

  return Array.from(churnMap.values()).sort(
    (a, b) => b.commits - a.commits || (b.insertions + b.deletions) - (a.insertions + a.deletions)
  );
}

async function getLogStats(
  targetPath: string
): Promise<{ totalCommits: number; firstCommitDate: string; lastCommitDate: string; recentActivity: { date: string; commits: number }[] }> {
  const { stdout: countOut } = await execFileAsync(
    "git",
    ["rev-list", "--count", "HEAD"],
    { cwd: targetPath }
  );
  const totalCommits = parseInt(countOut.trim());

  const { stdout: firstOut } = await execFileAsync(
    "git",
    ["log", "--reverse", "--format=%aI", "-1"],
    { cwd: targetPath }
  );
  const firstCommitDate = firstOut.trim();

  const { stdout: lastOut } = await execFileAsync(
    "git",
    ["log", "--format=%aI", "-1"],
    { cwd: targetPath }
  );
  const lastCommitDate = lastOut.trim();

  const { stdout: activityOut } = await execFileAsync(
    "git",
    ["log", "--since=30 days ago", "--format=%aI"],
    { cwd: targetPath }
  );

  const dayMap = new Map<string, number>();
  for (const line of activityOut.split("\n")) {
    if (!line) continue;
    const day = line.slice(0, 10);
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }

  const recentActivity = Array.from(dayMap.entries())
    .map(([date, commits]) => ({ date, commits }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { totalCommits, firstCommitDate, lastCommitDate, recentActivity };
}

async function getContributorCount(targetPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "git",
    ["shortlog", "-sn", "--no-merges", "HEAD"],
    { cwd: targetPath }
  );
  return stdout.split("\n").filter((l) => l.trim()).length;
}
