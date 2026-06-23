import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  buildSkippedChecks,
  Config,
  DEFAULT_PROJECT_SCAN_CONCURRENCY,
  DEFAULT_SHOW_WARNINGS,
  DeadCode,
  Files,
  Git,
  layerOtlp,
  Linter,
  LintPartialFailures,
  mapWithConcurrency,
  mergeReactDoctorConfigs,
  Progress,
  Project,
  Reporter,
  resolveScanTarget,
  restoreLegacyThrow,
  runInspect,
  Score,
  SupplyChain,
  warnAiTrainingLicenseOnce,
  type InspectOutput,
  type ResolvedScanTarget,
} from "@react-doctor/core";
import type {
  DiagnoseOptions,
  DiagnoseProjectsInput,
  DiagnoseProjectsResult,
  DiagnoseResult,
  ProjectDefinition,
  ProjectResult,
  ReactDoctorConfig,
  ScoreResult,
} from "@react-doctor/core";

const warnIfAiTrainingEnvironment = (): void => {
  warnAiTrainingLicenseOnce({
    write: (message) => {
      process.stderr.write(`[react-doctor] ${message}\n`);
    },
  });
};

interface BuildDiagnoseLayerInput {
  readonly config: ReactDoctorConfig | null;
  readonly configSourceDirectory: string | null;
  readonly resolvedDirectory: string;
  readonly shouldRunDeadCode: boolean;
  readonly shouldRunLint: boolean;
}

const buildDiagnoseLayer = (input: BuildDiagnoseLayerInput) => {
  const configLayer = Config.layerOf({
    config: input.config,
    resolvedDirectory: input.resolvedDirectory,
    configSourceDirectory: input.configSourceDirectory,
  });
  return Layer.mergeAll(
    Project.layerNode,
    configLayer,
    input.shouldRunDeadCode ? DeadCode.layerNode : DeadCode.layerOf([]),
    Files.layerNode,
    Git.layerNode,
    input.shouldRunLint ? Linter.layerOxlint : Linter.layerOf([]),
    LintPartialFailures.layerLive,
    Progress.layerNoop,
    Reporter.layerNoop,
    Score.layerHttp,
    input.config?.supplyChain?.enabled !== false ? SupplyChain.layerNode : SupplyChain.layerOf([]),
  );
};

const shouldRunDeadCode = (
  options: DiagnoseOptions,
  effectiveConfig: ReactDoctorConfig | null,
): boolean => options.deadCode ?? effectiveConfig?.deadCode ?? true;

const shouldRunLint = (
  options: DiagnoseOptions,
  effectiveConfig: ReactDoctorConfig | null,
): boolean => options.lint ?? effectiveConfig?.lint ?? true;

const buildInspectProgram = (
  scanTarget: ResolvedScanTarget,
  options: DiagnoseOptions,
  effectiveConfig: ReactDoctorConfig | null,
) => {
  const includePaths = options.includePaths ?? [];

  return runInspect({
    directory: scanTarget.resolvedDirectory,
    includePaths,
    customRulesOnly: effectiveConfig?.customRulesOnly ?? false,
    respectInlineDisables:
      options.respectInlineDisables ?? effectiveConfig?.respectInlineDisables ?? true,
    warnings: options.warnings ?? effectiveConfig?.warnings ?? DEFAULT_SHOW_WARNINGS,
    adoptExistingLintConfig: effectiveConfig?.adoptExistingLintConfig ?? true,
    ignoredTags: new Set(effectiveConfig?.ignore?.tags ?? []),
    runDeadCode: shouldRunDeadCode(options, effectiveConfig),
    isCi: false,
    resolveLocalGithubViewerPermission: true,
  });
};

const outputToDiagnoseResult = (
  output: InspectOutput,
  elapsedMilliseconds: number,
): DiagnoseResult => {
  // HACK: preserve the legacy behavior of writing lint failures to
  // stderr. The orchestrator already folds them into didLintFail /
  // lintFailureReason; this mirror keeps long-running scripts that
  // grep stderr for "Lint failed" working unchanged.
  if (output.didLintFail && output.lintFailureReason !== null) {
    console.error("Lint failed:", output.lintFailureReason);
  }

  const { skippedChecks, skippedCheckReasons } = buildSkippedChecks(output);

  return {
    diagnostics: [...output.diagnostics],
    score: output.score,
    skippedChecks,
    ...(Object.keys(skippedCheckReasons).length > 0 ? { skippedCheckReasons } : {}),
    project: output.project,
    elapsedMilliseconds,
  };
};

const diagnoseDirectory = async (
  directory: string,
  options: DiagnoseOptions,
): Promise<DiagnoseResult> => {
  const startTime = globalThis.performance.now();
  const scanTarget = await resolveScanTarget(directory);
  warnIfAiTrainingEnvironment();
  const effectiveConfig = scanTarget.userConfig;
  const program = buildInspectProgram(scanTarget, options, effectiveConfig);

  const output: InspectOutput = await Effect.runPromise(
    restoreLegacyThrow(
      program.pipe(
        Effect.provide(
          buildDiagnoseLayer({
            config: effectiveConfig,
            configSourceDirectory: scanTarget.configSourceDirectory,
            resolvedDirectory: scanTarget.resolvedDirectory,
            shouldRunDeadCode: shouldRunDeadCode(options, effectiveConfig),
            shouldRunLint: shouldRunLint(options, effectiveConfig),
          }),
        ),
        Effect.provide(layerOtlp),
      ),
    ),
  );

  return outputToDiagnoseResult(output, globalThis.performance.now() - startTime);
};

const findWorstScore = (projectResults: ProjectResult[]): ScoreResult | null => {
  let worstResult: ScoreResult | null = null;
  let worstScore = Number.POSITIVE_INFINITY;
  for (const projectResult of projectResults) {
    if (!projectResult.ok || projectResult.score === null) continue;
    if (projectResult.score.score < worstScore) {
      worstScore = projectResult.score.score;
      worstResult = projectResult.score;
    }
  }
  return worstResult;
};

const diagnoseProject = async (
  projectDefinition: ProjectDefinition,
  baseOptions: DiagnoseOptions,
  batchConfig: ReactDoctorConfig | undefined,
): Promise<ProjectResult> => {
  const startTime = globalThis.performance.now();

  try {
    const scanTarget = await resolveScanTarget(projectDefinition.directory);
    const { directory: _, config: projectConfig, ...perProjectOptions } = projectDefinition;
    const projectOptions = { ...baseOptions, ...perProjectOptions };

    const didOverrideConfig = batchConfig !== undefined || projectConfig !== undefined;
    const effectiveConfig = mergeReactDoctorConfigs(
      mergeReactDoctorConfigs(scanTarget.userConfig, batchConfig),
      projectConfig,
    );

    const program = buildInspectProgram(scanTarget, projectOptions, effectiveConfig);
    // `plugins` is override-wins in the merge: when a caller layer supplies
    // it, relative entries resolve against the scan root (caller configs
    // have no file location); otherwise the on-disk config's directory.
    const didOverridePlugins =
      batchConfig?.plugins !== undefined || projectConfig?.plugins !== undefined;
    const layer = buildDiagnoseLayer({
      config: effectiveConfig,
      configSourceDirectory:
        didOverrideConfig && didOverridePlugins ? null : scanTarget.configSourceDirectory,
      resolvedDirectory: scanTarget.resolvedDirectory,
      shouldRunDeadCode: shouldRunDeadCode(projectOptions, effectiveConfig),
      shouldRunLint: shouldRunLint(projectOptions, effectiveConfig),
    });

    const output: InspectOutput = await Effect.runPromise(
      restoreLegacyThrow(program.pipe(Effect.provide(layer), Effect.provide(layerOtlp))),
    );

    return {
      ok: true,
      ...outputToDiagnoseResult(output, globalThis.performance.now() - startTime),
      directory: scanTarget.resolvedDirectory,
    };
  } catch (error) {
    return {
      ok: false,
      directory: projectDefinition.directory,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
};

const diagnoseProjectBatch = async (
  input: DiagnoseProjectsInput,
): Promise<DiagnoseProjectsResult> => {
  const startTime = globalThis.performance.now();
  const { projects, concurrency, config: batchConfig, ...baseOptions } = input;
  if (projects.length > 0) warnIfAiTrainingEnvironment();

  // `diagnoseProject` never rejects (failures come back as `ok: false`),
  // so the pool always drains every project.
  const projectResults = await mapWithConcurrency(
    projects,
    concurrency ?? DEFAULT_PROJECT_SCAN_CONCURRENCY,
    (projectDefinition) => diagnoseProject(projectDefinition, baseOptions, batchConfig),
  );

  return {
    projects: projectResults,
    diagnostics: projectResults.flatMap((projectResult) =>
      projectResult.ok ? projectResult.diagnostics : [],
    ),
    score: findWorstScore(projectResults),
    elapsedMilliseconds: globalThis.performance.now() - startTime,
  };
};

interface Diagnose {
  /** Scan a single project directory and return diagnostics + score. */
  (directory: string, options?: DiagnoseOptions): Promise<DiagnoseResult>;
  /**
   * Scan multiple projects in parallel — each through the same pipeline as
   * the single-directory form — and return per-project results plus an
   * aggregate worst-of score. A failing project (e.g. no `package.json`)
   * comes back with `ok: false` instead of aborting the batch. Per-project
   * `config` layers on the batch `config`, which layers on each project's
   * on-disk config (see `mergeReactDoctorConfigs`).
   */
  (input: DiagnoseProjectsInput): Promise<DiagnoseProjectsResult>;
}

// HACK: the cast is required to assign the overload implementation (whose
// return type is the union of both signatures) to the overloaded interface
// — TypeScript can't verify that narrowing on the first argument selects
// the matching return type.
export const diagnose = (async (
  directoryOrInput: string | DiagnoseProjectsInput,
  options: DiagnoseOptions = {},
): Promise<DiagnoseResult | DiagnoseProjectsResult> =>
  typeof directoryOrInput === "string"
    ? diagnoseDirectory(directoryOrInput, options)
    : diagnoseProjectBatch(directoryOrInput)) as Diagnose;
