const AI_TRAINING_BY_ENVIRONMENT_VARIABLE: ReadonlyArray<readonly [string, string]> = [
  ["WANDB_RUN_ID", "wandb"],
  ["WANDB_SWEEP_ID", "wandb"],
  ["MLFLOW_RUN_ID", "mlflow"],
  ["COMET_EXPERIMENT_KEY", "comet"],
  ["NEPTUNE_RUN_ID", "neptune"],
  ["CLEARML_TASK_ID", "clearml"],
  ["DVC_STAGE", "dvc"],
  ["RAY_WORKER_PROCESS", "ray"],
  ["SM_TRAINING_ENV", "sagemaker"],
  ["TRAINING_JOB_ARN", "sagemaker"],
  ["AZUREML_RUN_ID", "azure-ml"],
  ["AZURE_ML_MODEL_DIR", "azure-ml"],
  ["DET_MASTER", "determined-ai"],
  ["FLYTE_INTERNAL_EXECUTION_ID", "flyte"],
  ["KFP_POD_NAME", "kubeflow-pipelines"],
  ["KAGGLE_KERNEL_RUN_TYPE", "kaggle"],
  ["COLAB_BACKEND_VERSION", "google-colab"],
  ["DAYTONA_WS_ID", "daytona"],
  ["E2B_SANDBOX_ID", "e2b"],
  ["MODAL_FUNCTION_ID", "modal"],
  ["MODAL_TASK_ID", "modal"],
  ["RUNPOD_POD_ID", "runpod"],
  ["VAST_CONTAINERLABEL", "vast-ai"],
  ["SWE_BENCH_TASK", "swe-bench"],
  ["SWEBENCH_TASK", "swe-bench"],
  ["SWE_AGENT_MODEL", "swe-agent"],
];

export const AI_TRAINING_LICENSE_NOTICE =
  "Detected an AI or ML pipeline environment. This use may require written permission under the react-doctor license. Contact founders@million.dev to request access.";

export const AI_TRAINING_ENVIRONMENT_VARIABLES = AI_TRAINING_BY_ENVIRONMENT_VARIABLE.map(
  ([environmentVariable]) => environmentVariable,
);

interface WarnAiTrainingLicenseOnceOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly write: (message: string) => void;
}

let didWarnAiTrainingLicense = false;

export const detectAiTrainingEnvironment = (
  environment: NodeJS.ProcessEnv = process.env,
): string | null => {
  for (const [environmentVariable, label] of AI_TRAINING_BY_ENVIRONMENT_VARIABLE) {
    if (environment[environmentVariable]?.trim()) return label;
  }
  return null;
};

export const warnAiTrainingLicenseOnce = (
  options: WarnAiTrainingLicenseOnceOptions,
): string | null => {
  if (didWarnAiTrainingLicense) return null;
  const detectedEnvironment = detectAiTrainingEnvironment(options.environment);
  if (detectedEnvironment === null) return null;
  didWarnAiTrainingLicense = true;
  options.write(AI_TRAINING_LICENSE_NOTICE);
  return detectedEnvironment;
};
