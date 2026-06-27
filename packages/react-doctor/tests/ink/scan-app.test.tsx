import { render } from "ink-testing-library";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { ScanApp } from "../../src/cli/ink/scan-app.js";
import { createScanStore } from "../../src/cli/ink/scan-store.js";

const makeDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  filePath: "src/Profile.tsx",
  plugin: "react-doctor",
  rule: "no-derived-state-effect",
  severity: "warning",
  message: "Your users briefly see stale state on every prop change.",
  help: "",
  line: 1,
  column: 1,
  category: "State & Effects",
  ...overrides,
});

const SCORE: ScoreResult = { score: 72, label: "Fair" };

// ink-testing-library needs a tick for effects (useInput wiring) to flush.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe("ScanApp", () => {
  it("renders the live scan view before a report settles", () => {
    const store = createScanStore();
    store.setProgress({ text: "Linting source files", status: "active" });
    store.emitDiagnostic(makeDiagnostic({ rule: "rules-of-hooks", severity: "error" }));

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Linting source files");
    expect(frame).toContain("1 found");
    unmount();
  });

  it("renders the score header and the full sorted rule list once settled", () => {
    const store = createScanStore();
    const diagnostics = [
      makeDiagnostic({ rule: "rules-of-hooks", severity: "error", category: "Correctness" }),
      makeDiagnostic({ rule: "no-array-index-key", filePath: "src/Cart.tsx", line: 9 }),
      makeDiagnostic({ rule: "no-array-index-key", filePath: "src/List.tsx", line: 4 }),
    ];
    store.setReport({
      diagnostics,
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 12,
      elapsedMilliseconds: 1234,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("72");
    expect(frame).toContain("demo-app");
    // No `title` on the test diagnostics → the row falls back to `plugin/rule`.
    expect(frame).toContain("Correctness: react-doctor/rules-of-hooks");
    // The second rule groups its two sites into one row with a count badge.
    expect(frame).toContain("×2");
    unmount();
  });

  it("shows the score projection and per-category breakdown", () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [
        makeDiagnostic({ rule: "rules-of-hooks", severity: "error", category: "Correctness" }),
        makeDiagnostic({ rule: "no-array-index-key", severity: "warning", category: "Bugs" }),
      ],
      score: SCORE,
      projectedScore: 88,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 3,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("You could improve");
    expect(frame).toContain("+16%");
    expect(frame).toContain("Correctness");
    expect(frame).toContain("Bugs");
    unmount();
  });

  it("renders the no-score header when the score is unavailable", () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: null,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score disabled by --no-score.",
    });

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    expect(lastFrame() ?? "").toContain("Score disabled by --no-score.");
    unmount();
  });

  it("renders the monorepo summary with aggregate score and project rows", () => {
    const store = createScanStore();
    const webReport = {
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: { score: 58, label: "Needs work" } as ScoreResult,
      projectedScore: null,
      projectName: "web",
      rootDirectory: "/tmp/repo/apps/web",
      scannedFileCount: 4,
      elapsedMilliseconds: 5,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    };
    const apiReport = {
      diagnostics: [makeDiagnostic({ rule: "no-array-index-key", severity: "warning" })],
      score: { score: 91, label: "Great" } as ScoreResult,
      projectedScore: null,
      projectName: "api",
      rootDirectory: "/tmp/repo/apps/api",
      scannedFileCount: 6,
      elapsedMilliseconds: 5,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    };
    store.setSummary({
      projects: [webReport, apiReport],
      aggregateScore: webReport.score,
      projectedScore: null,
      combinedDiagnostics: [...webReport.diagnostics, ...apiReport.diagnostics],
      scannedFileCount: 10,
      elapsedMilliseconds: 12,
      projectName: "repo",
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    const frame = lastFrame() ?? "";
    // Aggregate score is the worst project's (58, not 91).
    expect(frame).toContain("58");
    expect(frame).toContain("web");
    expect(frame).toContain("api");
    expect(frame).toContain("2 projects");
    unmount();
  });

  it("moves the selection with j/k and quits on q", async () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [
        makeDiagnostic({ rule: "rules-of-hooks", severity: "error", category: "Correctness" }),
        makeDiagnostic({ rule: "no-array-index-key", filePath: "src/Cart.tsx", line: 9 }),
      ],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 2,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, unmount } = render(<ScanApp store={store} />);
    await flush();

    // First row selected by default → detail pane shows the first rule's message.
    expect(lastFrame() ?? "").toContain("Correctness: react-doctor/rules-of-hooks");

    stdin.write("j");
    await flush();
    // After moving down, the detail pane reflects the second rule.
    expect(lastFrame() ?? "").toContain("no-array-index-key");

    // `q` is handled without throwing (exit is wired through useApp()).
    stdin.write("q");
    await flush();
    unmount();
  });
});
