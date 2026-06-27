import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import type { WorkspacePackage } from "@react-doctor/core";
import { ProjectSelect } from "../../src/cli/ink/components/project-select.js";

const PACKAGES: WorkspacePackage[] = [
  { name: "web", directory: "/repo/apps/web" },
  { name: "docs", directory: "/repo/apps/docs" },
];

// ink-testing-library needs a tick for effects (useInput wiring) to flush.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe("ProjectSelect", () => {
  it("submits the selected directories when Enter is pressed", async () => {
    const onSubmit = vi.fn();
    const { stdin, unmount } = render(
      <ProjectSelect packages={PACKAGES} rootDirectory="/repo" onSubmit={onSubmit} />,
    );
    await flush();

    // Enter arrives as a carriage return that Ink normalizes to `key.return`.
    stdin.write("\r");
    await flush();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(["/repo/apps/web", "/repo/apps/docs"]);
    unmount();
  });
});
