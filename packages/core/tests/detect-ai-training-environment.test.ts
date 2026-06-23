import { describe, expect, it, vi } from "vite-plus/test";
import {
  AI_TRAINING_ENVIRONMENT_VARIABLES,
  AI_TRAINING_LICENSE_NOTICE,
  detectAiTrainingEnvironment,
} from "../src/utils/detect-ai-training-environment.js";

describe("detectAiTrainingEnvironment", () => {
  it("returns null without AI training signals", () => {
    expect(detectAiTrainingEnvironment({})).toBeNull();
  });

  it.each([
    ["WANDB_RUN_ID", "wandb"],
    ["SM_TRAINING_ENV", "sagemaker"],
    ["E2B_SANDBOX_ID", "e2b"],
    ["SWE_BENCH_TASK", "swe-bench"],
    ["COLAB_BACKEND_VERSION", "google-colab"],
  ])("returns %s's label", (environmentVariable, expectedLabel) => {
    expect(detectAiTrainingEnvironment({ [environmentVariable]: "active" })).toBe(expectedLabel);
  });

  it("ignores empty and whitespace-only values", () => {
    expect(detectAiTrainingEnvironment({ WANDB_RUN_ID: "" })).toBeNull();
    expect(detectAiTrainingEnvironment({ WANDB_RUN_ID: "   " })).toBeNull();
  });

  it("does not match credentials, coding-agent markers, or broad local config", () => {
    expect(
      detectAiTrainingEnvironment({
        CUDA_VISIBLE_DEVICES: "0",
        CURSOR_AGENT: "1",
        HF_HOME: "/tmp/huggingface",
        HF_TOKEN: "token",
        HARBOR_URL: "https://harbor.example",
        OPENAI_API_KEY: "token",
        REPLICATE_USERNAME: "user",
      }),
    ).toBeNull();
  });

  it("returns the first matching label", () => {
    expect(
      detectAiTrainingEnvironment({
        E2B_SANDBOX_ID: "sandbox",
        WANDB_RUN_ID: "run",
      }),
    ).toBe("wandb");
  });

  it("exports the presence-based environment variable list", () => {
    expect(AI_TRAINING_ENVIRONMENT_VARIABLES).toContain("WANDB_RUN_ID");
    expect(AI_TRAINING_ENVIRONMENT_VARIABLES).not.toContain("OPENAI_API_KEY");
  });
});

describe("warnAiTrainingLicenseOnce", () => {
  it("writes the shared notice once and returns the detected label", async () => {
    vi.resetModules();
    const { warnAiTrainingLicenseOnce } =
      await import("../src/utils/detect-ai-training-environment.js");
    const messages: string[] = [];

    const firstDetectedEnvironment = warnAiTrainingLicenseOnce({
      environment: { WANDB_RUN_ID: "run" },
      write: (message) => messages.push(message),
    });
    const secondDetectedEnvironment = warnAiTrainingLicenseOnce({
      environment: { MLFLOW_RUN_ID: "run" },
      write: (message) => messages.push(message),
    });

    expect(firstDetectedEnvironment).toBe("wandb");
    expect(secondDetectedEnvironment).toBeNull();
    expect(messages).toEqual([AI_TRAINING_LICENSE_NOTICE]);
  });
});
