import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AI_TRAINING_ENVIRONMENT_VARIABLES } from "@react-doctor/core";
import { silenceConsoleForTest } from "./helpers/silence-console.js";

const { mockRecordCount } = vi.hoisted(() => ({
  mockRecordCount: vi.fn(),
}));

vi.mock("../src/cli/utils/record-metric.js", () => ({
  recordCount: mockRecordCount,
  recordDistribution: vi.fn(),
}));

interface CapturedStderr {
  readonly chunks: string[];
  readonly restore: () => void;
}

const ENVIRONMENT_VARIABLES = [...AI_TRAINING_ENVIRONMENT_VARIABLES];

const captureStderr = (): CapturedStderr => {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8"));
    return true;
  }) as never);
  return { chunks, restore: () => spy.mockRestore() };
};

describe("warnIfAiTrainingEnvironment", () => {
  let savedEnv: Record<string, string | undefined>;
  let capturedStderr: CapturedStderr;

  beforeEach(() => {
    vi.resetModules();
    mockRecordCount.mockReset();
    capturedStderr = captureStderr();
    savedEnv = {};
    for (const environmentVariable of ENVIRONMENT_VARIABLES) {
      savedEnv[environmentVariable] = process.env[environmentVariable];
      delete process.env[environmentVariable];
    }
  });

  afterEach(() => {
    capturedStderr.restore();
    for (const environmentVariable of ENVIRONMENT_VARIABLES) {
      const previousValue = savedEnv[environmentVariable];
      if (previousValue === undefined) {
        delete process.env[environmentVariable];
      } else {
        process.env[environmentVariable] = previousValue;
      }
    }
  });

  it("does not write or emit metrics without a training signal", async () => {
    const { warnIfAiTrainingEnvironment } =
      await import("../src/cli/utils/warn-ai-training-environment.js");

    warnIfAiTrainingEnvironment();

    expect(capturedStderr.chunks).toEqual([]);
    expect(mockRecordCount).not.toHaveBeenCalled();
  });

  it("writes the license notice to stderr once and records the detected environment", async () => {
    process.env.WANDB_RUN_ID = "run";
    const { warnIfAiTrainingEnvironment } =
      await import("../src/cli/utils/warn-ai-training-environment.js");

    warnIfAiTrainingEnvironment();
    warnIfAiTrainingEnvironment();

    expect(capturedStderr.chunks).toHaveLength(1);
    expect(capturedStderr.chunks.join("")).toContain("[react-doctor]");
    expect(capturedStderr.chunks.join("")).toContain("founders@million.dev");
    expect(mockRecordCount).toHaveBeenCalledTimes(1);
    expect(mockRecordCount).toHaveBeenCalledWith("ai.training.warning_shown", 1, {
      environment: "wandb",
    });
  });

  it("still writes to stderr when the global console is silenced", async () => {
    process.env.E2B_SANDBOX_ID = "sandbox";
    const restoreConsole = silenceConsoleForTest();
    try {
      const { warnIfAiTrainingEnvironment } =
        await import("../src/cli/utils/warn-ai-training-environment.js");

      warnIfAiTrainingEnvironment();
    } finally {
      restoreConsole();
    }

    expect(capturedStderr.chunks.join("")).toContain("AI or ML pipeline");
  });
});
