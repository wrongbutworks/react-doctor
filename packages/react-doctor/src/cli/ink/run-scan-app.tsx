import path from "node:path";
import { performance } from "node:perf_hooks";
import { render } from "ink";
import * as Effect from "effect/Effect";
import {
  DEFAULT_PROJECT_SCAN_CONCURRENCY,
  highlighter,
  mapWithConcurrency,
  resolveScanTarget,
} from "@react-doctor/core";
import type { Diagnostic, InspectResult, ScoreResult, WorkspacePackage } from "@react-doctor/core";
import { inspect } from "../../inspect.js";
import type { ReactDoctorInspectOptions } from "../../inspect.js";
import { buildNoScoreMessage } from "../utils/build-no-score-message.js";
import { computeProjectedScore } from "../utils/compute-score-projection.js";
import { countUniqueScannedFiles } from "../utils/count-unique-scanned-files.js";
import { discoverWorkspacePackages, selectProjects } from "../utils/select-projects.js";
import { isCiEnvironment } from "../utils/is-ci-environment.js";
import { formatElapsedTime } from "../utils/render-diagnostics.js";
import { printFooter } from "../utils/render-summary.js";
import { detectLaunchableAgents } from "../utils/detect-launchable-agents.js";
import { CLI_AGENT_BINARIES, launchCliAgent } from "../utils/launch-agent.js";
import { isReactDoctorWorkflowInstalled } from "../utils/install-github-workflow.js";
import { findNearestPackageDirectory } from "../utils/install-doctor-script.js";
import { setUpGitHubActions } from "../utils/set-up-github-actions.js";
import { recordCount } from "../utils/record-metric.js";
import { METRIC } from "../utils/constants.js";
import { ProjectSelect } from "./components/project-select.js";
import { ScanApp } from "./scan-app.js";
import { createScanStore } from "./scan-store.js";
import type { MultiProjectSummary, ScanReport, TuiHandoffRequest } from "./scan-store.js";

export interface RunScanAppInput {
  readonly directory: string;
  readonly options?: ReactDoctorInspectOptions;
  /** `--project` value (comma list or `*`); resolves without the interactive prompt. */
  readonly projectFlag?: string;
  /** `-y`/`--yes`: skip the prompt and scan every discovered project. */
  readonly skipPrompts?: boolean;
  /**
   * Persistent `projects` from the user's config. When omitted, `runScanApp`
   * loads it from the resolved scan target (parity with the static CLI).
   */
  readonly configProjects?: readonly string[];
  /**
   * Whether the Share URL may be printed (the config's `share`, default true).
   * When omitted, `runScanApp` loads it from the resolved scan target.
   */
  readonly share?: boolean;
}

export interface RunScanAppResult {
  readonly errorCount: number;
  readonly warningCount: number;
}

const countBySeverity = (diagnostics: ReadonlyArray<Diagnostic>, severity: string): number =>
  diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;

// Rewrites a project's diagnostics so their `filePath` is relative to the
// monorepo root rather than the project root. This lets the flat summary render
// every project's findings in one list — the path itself shows the folder, and
// the shared monorepo root resolves every code frame. A no-op for the root
// project (empty prefix) and for already-absolute paths.
const qualifyDiagnosticPaths = (
  diagnostics: ReadonlyArray<Diagnostic>,
  rootDirectory: string,
  projectDirectory: string,
): Diagnostic[] => {
  const prefix = path.relative(rootDirectory, projectDirectory);
  if (prefix === "" || prefix.startsWith("..")) return [...diagnostics];
  return diagnostics.map((diagnostic) =>
    path.isAbsolute(diagnostic.filePath)
      ? diagnostic
      : { ...diagnostic, filePath: path.join(prefix, diagnostic.filePath) },
  );
};

// The share URL is suppressed for --no-score, `share: false` in config, and in
// CI, mirroring the CLI's `shouldShowShareLink` gate exactly (CI only — it does
// not additionally gate on coding-agent environments).
const resolveIsOffline = (input: RunScanAppInput): boolean =>
  input.options?.noScore === true || input.share === false || isCiEnvironment();

/** Resolves the directories to scan, prompting via Ink only when truly interactive. */
const resolveSelectedDirectories = async (
  rootDirectory: string,
  input: RunScanAppInput,
): Promise<string[]> => {
  const packages = discoverWorkspacePackages(rootDirectory);
  const needsPrompt =
    packages.length > 1 &&
    !input.projectFlag &&
    !input.skipPrompts &&
    (input.configProjects ?? []).length === 0 &&
    process.stdin.isTTY === true;

  if (!needsPrompt) {
    return selectProjects(
      rootDirectory,
      input.projectFlag,
      input.skipPrompts ?? false,
      input.configProjects,
    );
  }

  return promptProjectSelection(packages, rootDirectory);
};

const promptProjectSelection = (
  packages: ReadonlyArray<WorkspacePackage>,
  rootDirectory: string,
): Promise<string[]> =>
  new Promise((resolve) => {
    const instance = render(
      <ProjectSelect
        packages={packages}
        rootDirectory={rootDirectory}
        onSubmit={(directories) => {
          // Wipe the picker's last frame so its footer/list doesn't linger in
          // scrollback above the scan view once a selection is made.
          instance.clear();
          instance.unmount();
          resolve(directories);
        }}
      />,
      { exitOnCtrlC: false },
    );
  });

interface ScanReportInput {
  readonly result: InspectResult;
  readonly rootDirectory: string;
  readonly projectedScore: number | null;
  readonly isOffline: boolean;
  readonly noScoreMessage: string;
}

const toScanReport = ({
  result,
  rootDirectory,
  projectedScore,
  isOffline,
  noScoreMessage,
}: ScanReportInput): ScanReport => ({
  diagnostics: result.diagnostics,
  score: result.score,
  projectedScore,
  projectName: result.project.projectName,
  rootDirectory,
  scannedFileCount: result.scannedFileCount ?? 0,
  elapsedMilliseconds: result.elapsedMilliseconds,
  isOffline,
  noScoreMessage,
});

// The aggregate score for a monorepo is its WORST project's (a chain is only as
// strong as its weakest link), so the projection is computed against it too.
const findLowestScored = (
  reports: ReadonlyArray<{ score: ScoreResult | null; diagnostics: ReadonlyArray<Diagnostic> }>,
): { score: ScoreResult; diagnostics: ReadonlyArray<Diagnostic> } | null => {
  let worst: { score: ScoreResult; diagnostics: ReadonlyArray<Diagnostic> } | null = null;
  for (const report of reports) {
    if (report.score === null) continue;
    if (worst === null || report.score.score < worst.score.score) {
      worst = { score: report.score, diagnostics: report.diagnostics };
    }
  }
  return worst;
};

interface ExitFooterInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly scoreResult: ScoreResult | null;
  readonly projectName: string;
  readonly scannedFileCount: number;
  readonly elapsedMilliseconds: number;
  readonly isOffline: boolean;
  /** The reason lint was skipped, if it failed — surfaced like the static CLI does. */
  readonly lintFailureReason: string | null;
}

// The Ink report never shows the post-scan lint-failure hint (it's suppressed
// when `uiStore` is active), so the exit footer surfaces it instead — otherwise
// a TUI report could look clean while oxlint silently failed.
const resolveLintFailureReason = (results: ReadonlyArray<InspectResult>): string | null => {
  for (const result of results) {
    const reason = result.skippedCheckReasons?.lint;
    if (reason) return reason;
  }
  return null;
};

const printExitFooter = async (input: ExitFooterInput): Promise<void> => {
  const fileLabel = input.scannedFileCount === 1 ? "file" : "files";
  process.stdout.write(
    `${highlighter.success("✔")} Scanned ${input.scannedFileCount} ${fileLabel} in ${formatElapsedTime(input.elapsedMilliseconds)}\n`,
  );
  if (input.lintFailureReason !== null) {
    process.stdout.write(`${highlighter.warn("⚠")} Lint did not run: ${input.lintFailureReason}\n`);
  }
  await Effect.runPromise(
    printFooter({
      diagnostics: [...input.diagnostics],
      scoreResult: input.scoreResult,
      projectName: input.projectName,
      isOffline: input.isOffline,
    }),
  );
};

// Fulfills a triage handoff once the Ink app has unmounted (so the agent CLI
// can take over this TTY). On launch failure the prompt is printed instead, so
// the user can paste it into any agent — mirroring the post-scan handoff.
const performTuiHandoff = async (
  request: TuiHandoffRequest,
  rootDirectory: string,
): Promise<void> => {
  try {
    await launchCliAgent(request.agentId, request.prompt, rootDirectory);
  } catch {
    process.stdout.write(
      `${highlighter.warn("⚠")} Couldn't launch ${CLI_AGENT_BINARIES[request.agentId]}. Here's the prompt instead:\n`,
    );
    process.stdout.write(`${highlighter.dim("──── Agent prompt ────")}\n`);
    process.stdout.write(`${request.prompt}\n`);
    process.stdout.write(`${highlighter.dim("──────────────────────")}\n`);
  }
};

// Whether this directory's nearest package lacks a React Doctor CI workflow —
// gates the report's "add to CI" callout to repos that aren't wired up yet.
const isCiUnconfigured = (directory: string): boolean =>
  !isReactDoctorWorkflowInstalled(findNearestPackageDirectory(directory) ?? directory);

// Scaffolds the GitHub Actions workflow once the Ink app has unmounted (it logs
// + opens a PR via spinners, which can't run while Ink owns the terminal).
// `agent.handoff` is the shared post-scan funnel metric — `handoff-to-agent`
// tags its CI branch `outcome: "ci-yes"`, so the TUI mirrors that and adds
// `source: "tui"` plus whether a workflow was actually written.
const performCiSetup = async (rootDirectory: string): Promise<void> => {
  const didCreateWorkflow = await setUpGitHubActions({ rootDirectory });
  recordCount(METRIC.agentHandoff, 1, {
    outcome: "ci-yes",
    source: "tui",
    created: didCreateWorkflow,
  });
};

// Renders the interactive scan app wired to capture the two deferred actions
// (agent handoff + CI setup) that can't run while Ink owns the terminal, and
// returns a `settle()` that performs them — CI first, then handoff — once the
// app has unmounted. `rootDirectory` is the folder both actions target.
const mountScanApp = async (rootDirectory: string) => {
  const store = createScanStore();
  const launchableAgents = await detectLaunchableAgents();
  const pending: { handoff: TuiHandoffRequest | null; ciSetup: boolean } = {
    handoff: null,
    ciSetup: false,
  };
  const instance = render(
    <ScanApp
      store={store}
      launchableAgents={launchableAgents}
      onHandoff={(request) => {
        pending.handoff = request;
      }}
      canAddToCi={isCiUnconfigured(rootDirectory)}
      onAddToCi={() => {
        pending.ciSetup = true;
      }}
    />,
    { exitOnCtrlC: false },
  );
  const settle = async (): Promise<void> => {
    if (pending.ciSetup) await performCiSetup(rootDirectory);
    if (pending.handoff) await performTuiHandoff(pending.handoff, rootDirectory);
  };
  return { store, instance, settle };
};

const runSingleProjectScan = async (
  directory: string,
  input: RunScanAppInput,
): Promise<RunScanAppResult> => {
  const { store, instance, settle } = await mountScanApp(directory);
  const isOffline = resolveIsOffline(input);
  const noScoreMessage = buildNoScoreMessage(input.options?.noScore === true);

  try {
    const result = await inspect(directory, { ...input.options, uiStore: store });
    const projectedScore = result.score
      ? await computeProjectedScore([...result.diagnostics], [...result.diagnostics], result.score)
      : null;
    store.setReport(
      toScanReport({ result, rootDirectory: directory, projectedScore, isOffline, noScoreMessage }),
    );
    await instance.waitUntilExit();
    await settle();
    await printExitFooter({
      diagnostics: result.diagnostics,
      scoreResult: result.score,
      projectName: result.project.projectName,
      scannedFileCount: result.scannedFileCount ?? 0,
      elapsedMilliseconds: result.elapsedMilliseconds,
      isOffline,
      lintFailureReason: resolveLintFailureReason([result]),
    });
    return {
      errorCount: countBySeverity(result.diagnostics, "error"),
      warningCount: countBySeverity(result.diagnostics, "warning"),
    };
  } catch (error) {
    instance.unmount();
    throw error;
  }
};

const runMultiProjectScan = async (
  rootDirectory: string,
  directories: ReadonlyArray<string>,
  input: RunScanAppInput,
): Promise<RunScanAppResult> => {
  const { store, instance, settle } = await mountScanApp(rootDirectory);
  const isOffline = resolveIsOffline(input);
  const noScoreMessage = buildNoScoreMessage(input.options?.noScore === true);

  try {
    const startTime = performance.now();
    let finishedCount = 0;
    store.setProgress({
      text: `Scanning ${directories.length} projects…`,
      status: "active",
    });
    const results = await mapWithConcurrency(
      [...directories],
      DEFAULT_PROJECT_SCAN_CONCURRENCY,
      async (projectDirectory) => {
        const result = await inspect(projectDirectory, {
          ...input.options,
          // Stream each project's diagnostics into the shared store so the live
          // scan view shows the error feed (uiStore implies suppressRendering);
          // `concurrentScan` keeps per-project progress off the shared counter.
          uiStore: store,
          concurrentScan: true,
        });
        finishedCount += 1;
        store.setProgress({
          text: `Scanning ${directories.length} projects… (${finishedCount}/${directories.length})`,
          status: "active",
        });
        return { directory: projectDirectory, result };
      },
    );

    const projects = results.map(({ directory, result }) =>
      toScanReport({
        result,
        rootDirectory: directory,
        projectedScore: null,
        isOffline,
        noScoreMessage,
      }),
    );
    const combinedDiagnostics = projects.flatMap((project) =>
      qualifyDiagnosticPaths(project.diagnostics, rootDirectory, project.rootDirectory),
    );
    const worst = findLowestScored(projects);
    const projectedScore = worst
      ? await computeProjectedScore(combinedDiagnostics, [...worst.diagnostics], worst.score)
      : null;
    // Dedupe by absolute path so nested workspace packages don't double-count
    // shared files — parity with the static monorepo summary.
    const scannedFileCount = countUniqueScannedFiles(results.map(({ result }) => result));
    const elapsedMilliseconds = performance.now() - startTime;

    const summary: MultiProjectSummary = {
      projects,
      aggregateScore: worst?.score ?? null,
      projectedScore,
      combinedDiagnostics,
      scannedFileCount,
      elapsedMilliseconds,
      projectName: path.basename(rootDirectory),
      rootDirectory,
      isOffline,
      noScoreMessage,
    };
    store.setSummary(summary);
    await instance.waitUntilExit();
    await settle();
    await printExitFooter({
      diagnostics: combinedDiagnostics,
      scoreResult: summary.aggregateScore,
      projectName: summary.projectName,
      scannedFileCount,
      elapsedMilliseconds,
      isOffline,
      lintFailureReason: resolveLintFailureReason(results.map(({ result }) => result)),
    });
    return {
      errorCount: countBySeverity(combinedDiagnostics, "error"),
      warningCount: countBySeverity(combinedDiagnostics, "warning"),
    };
  } catch (error) {
    instance.unmount();
    throw error;
  }
};

/**
 * Entry point for the interactive Ink scan UI. Discovers and (when interactive)
 * prompts for the workspace projects to scan, then mounts the live scan view and
 * routes to the single-project report or the monorepo summary once settled. On
 * exit it prints a concise static footer (scanned files + Share / Docs / GitHub).
 */
export const runScanApp = async (input: RunScanAppInput): Promise<RunScanAppResult> => {
  // Resolve the scan target once so the TUI honors the same on-disk config the
  // static CLI does: the `rootDir` redirect, the persistent `projects` list, and
  // the `share` gate (each only filled in when the caller didn't pass it).
  const scanTarget = await resolveScanTarget(input.directory);
  const rootDirectory = scanTarget.resolvedDirectory;
  const resolvedInput: RunScanAppInput = {
    ...input,
    configProjects: input.configProjects ?? scanTarget.userConfig?.projects,
    share: input.share ?? scanTarget.userConfig?.share ?? true,
  };
  const selectedDirectories = await resolveSelectedDirectories(rootDirectory, resolvedInput);

  if (selectedDirectories.length === 0) {
    return { errorCount: 0, warningCount: 0 };
  }
  if (selectedDirectories.length === 1) {
    return runSingleProjectScan(selectedDirectories[0], resolvedInput);
  }
  return runMultiProjectScan(rootDirectory, selectedDirectories, resolvedInput);
};
