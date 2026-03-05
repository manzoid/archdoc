export interface LanguageStat {
  Name: string;
  Bytes: number;
  CodeBytes: number;
  Lines: number;
  Code: number;
  Comment: number;
  Blank: number;
  Complexity: number;
  Count: number;
  WeightedComplexity: number;
}

export interface CodeStatsHarvest {
  languages: LanguageStat[];
  totalFiles: number;
  totalLines: number;
  totalCode: number;
  totalComment: number;
  totalBlank: number;
  totalComplexity: number;
}

export interface RfcSymbol {
  name: string;
  kind: "function" | "method" | "class";
  file: string;
  line: number;
  feature: string;
}

export interface RfcTotals {
  symbols: number;
  functions: number;
  methods: number;
  classes: number;
}

export interface Feature {
  name: string;
  symbolCount: number;
  functions: number;
  methods: number;
  classes: number;
  files: string[];
  churn?: number;
}

export interface FeatureCensusHarvest {
  features: Feature[];
  symbols: RfcSymbol[];
  totals: RfcTotals;
  totalSymbols: number;
  totalFeatures: number;
  /** Directory-grouped summary for AI consumption */
  directoryGroups: DirectoryGroup[];
}

export interface DirectoryGroup {
  directory: string;
  functions: number;
  methods: number;
  classes: number;
  total: number;
  sampleSymbols: string[];
}

export interface FileChurn {
  path: string;
  commits: number;
  insertions: number;
  deletions: number;
}

export interface GitAnalysisHarvest {
  topChurnFiles: FileChurn[];
  totalCommits: number;
  firstCommitDate: string;
  lastCommitDate: string;
  contributors: number;
  recentActivity: { date: string; commits: number }[];
}

// ── Test Census (test-intent-map) ─────────────────────────────

export interface TestInferredSource {
  path: string;
  confidence: "import" | "path" | "mock";
  evidence: string;
}

export interface TestFileEntry {
  path: string;
  group: string;
  language: string;
  testCount: number;
  inferredSources: TestInferredSource[];
}

export interface TestEntry {
  id: number;
  testFile: string;
  group: string;
  language: string;
  className: string | null;
  methodName: string;
  qualifiedName: string;
  line: number;
  endLine: number | null;
  inferredSources: string[];
}

export interface TestCensusHarvest {
  repo: string;
  extractedAt: string;
  totals: { testFiles: number; testClasses: number; tests: number };
  languages: string[];
  testFiles: TestFileEntry[];
  tests: TestEntry[];
}
