import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnguardedBrowserGlobalInRenderOrHookInit } from "./no-unguarded-browser-global-in-render-or-hook-init.js";

describe("no-unguarded-browser-global-in-render-or-hook-init", () => {
  it("does not flag a window read inside JSX gated by a show* state flag (confetti idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function Modal() {
        const [showConfetti, setShowConfetti] = useState(false);
        return <div>{showConfetti && <Confetti width={window.innerWidth} height={window.innerHeight} />}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a window read on the right of an open-suffixed visibility flag", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function Layout() {
        const [navOpen, setNavOpen] = useState(false);
        const isDrawer = navOpen && window.matchMedia('(max-width: 768px)').matches;
        return <nav data-drawer={isDrawer} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags navigator.onLine as a useState argument in a custom hook", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `export const useOnlineChange = () => {
        const [online, setOnline] = useState(navigator.onLine);
        return online;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags document read inside a useState lazy initializer", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useIsDocumentHidden = () => {
        const [hidden, setHidden] = useState(() => document.hidden);
        return hidden;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a bare window read in a component body", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const width = window.innerWidth;
        return <div style={{ width }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags localStorage read in a useState initializer", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useToken = () => {
        const [token] = useState(() => localStorage.getItem('token'));
        return token;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a react-router location local (not window.location)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const usePath = () => {
        const location = useLocation();
        const pathname = location.pathname;
        return pathname;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a read inside a useEffect callback", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useOnline = () => {
        const [online, setOnline] = useState(false);
        useEffect(() => {
          setOnline(navigator.onLine);
        }, []);
        return online;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a read inside an event handler", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const handleClick = () => {
          const width = window.innerWidth;
          return width;
        };
        return <button onClick={handleClick} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet behind a dominating typeof window guard", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const width = typeof window !== 'undefined' ? window.innerWidth : 0;
        return <div style={{ width }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for the nested-deref guarded SSR-safe idiom", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const host = typeof window === 'undefined' ? '' : window.location.hostname;
        return <div>{host}</div>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet behind a canUseDOM guard", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const width = canUseDOM ? window.innerWidth : 0;
        return <div style={{ width }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when navigator is a local shadow binding", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useThing = () => {
        const navigator = getFakeAgent();
        const [online] = useState(navigator.onLine);
        return online;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a read inside a useMemo callback", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useWidth = () => {
        const width = useMemo(() => window.innerWidth, []);
        return width;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet after a typeof-window early return (the SSR guard the rule itself recommends)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        if (typeof window === 'undefined') return null;
        return <div>{window.innerWidth}</div>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet after a mounted-state early return (the useEffect-mounted idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const [mounted, setMounted] = useState(false);
        useEffect(() => setMounted(true), []);
        if (!mounted) return null;
        return <div>{window.innerWidth}</div>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when an early return dominates a useState lazy initializer", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useWidth = () => {
        if (typeof window === 'undefined') return 0;
        const [width] = useState(() => window.innerWidth);
        return width;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a function stored in a useRef (never invoked at render time)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const cleanupRef = useRef(() => document.removeEventListener('click', noop));
        return <div />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a bare browser read passed to useRef (evaluated during render)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const widthRef = useRef(window.innerWidth);
        return <div />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for the try/catch persisted-state idiom in a useState lazy initializer", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const useToken = () => {
        const [token] = useState(() => {
          try {
            return localStorage.getItem('token');
          } catch {
            return null;
          }
        });
        return token;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet behind rc-util's lowercase canUseDom() guard", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `import canUseDom from 'rc-util/lib/Dom/canUseDom';
      function App() {
        const width = canUseDom() ? window.innerWidth : 0;
        return <div style={{ width }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet behind an off-list const guard whose initializer is a typeof-window check", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const isBrowserEnv = typeof window !== 'undefined';
      function App() {
        const width = isBrowserEnv ? window.innerWidth : 0;
        return <div style={{ width }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags destructuring a browser global in a component body", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const { innerWidth } = window;
        return <div style={{ width: innerWidth }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags aliasing a browser global in a component body", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function App() {
        const win = window;
        return <div style={{ width: win.innerWidth }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for a createPortal container read behind an open early return", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function ColorPickerFloating({ open, onColorSelect }) {
        if (!open) return null;
        return createPortal(<div onClick={onColorSelect} />, document.body);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a createPortal container read without a preceding gate", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const Overlay = ({ children }) => {
        return createPortal(children, document.body);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet after a flow-terminating negated showX gate (the tooltip idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const UndoButton = ({ showTooltip = true }) => {
        const button = <button aria-label="Undo" />;
        if (!showTooltip) {
          return button;
        }
        return (
          <Tooltip trigger={button}>
            {navigator.platform.includes('Mac') ? 'Cmd+Z' : 'Ctrl+Z'}
          </Tooltip>
        );
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet after a negated isVisible early return", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function Modal({ isVisible }) {
        if (!isVisible) return null;
        return <div>{window.location.href}</div>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags unconditional window.location reads at the top of a modal body", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `export default function ShareSurveyModal({ surveyId, isOpened, closeModal }) {
        const link = \`\${window.location.protocol}//\${window.location.host}/survey/\${surveyId}\`;
        return <StyledDialog isOpen={isOpened} onClose={closeModal}>{link}</StyledDialog>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("still flags a read after an early return on a non-visibility flag", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function Profile({ user }) {
        if (!user) return null;
        const width = window.innerWidth;
        return <div style={{ width }} />;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet outside a component or hook body", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const readWidth = () => {
        return window.innerWidth;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag after an import.meta.env.SSR early return", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `export const Widget = () => {
        if (import.meta.env.SSR) return null;
        const width = window.innerWidth;
        return <div style={{ width }} />;
      };`,
      { filename: "widget.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a typeof globalThis.window guard", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `export const Widget = () => {
        if (typeof globalThis.window === "undefined") return null;
        return <div style={{ width: window.innerWidth }} />;
      };`,
      { filename: "widget.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useSyncExternalStore client snapshot", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `export const useWidth = () =>
        useSyncExternalStore(subscribeToResize, () => window.innerWidth, () => 0);`,
      { filename: "use-width.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in Gatsby cache-dir client runtime files (fast-refresh overlay hooks)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `export function useStackFrame({ moduleId }) {
        const url = '/__original-stack-frame?moduleId=' + window.encodeURIComponent(moduleId);
        const [response, setResponse] = React.useState(null);
        return response;
      }`,
      { filename: "packages/gatsby/cache-dir/fast-refresh-overlay/components/hooks.js" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in Remix .client. module files", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `export const Dashboard = () => <a href={window.origin + '/builder'}>Open</a>;`,
      { filename: "app/dashboard/index.client.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when the module already throws under a typeof-window check (Gatsby loading-indicator idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `if (typeof window === 'undefined') {
        throw new Error("Loading indicator should never be imported in code that doesn't target only browsers");
      }
      export function Indicator() {
        if (!window.___gatsbyDidShowLoadingIndicatorBefore) {
          debugLog(window.location.origin + '/___loading-indicator/disable');
        }
        return <div />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in a component exported through dynamic(..., { ssr: false }) in the same file", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `export function DBSearchPage() {
        const paths = window.location.pathname.split('/');
        return <div>{paths.length}</div>;
      }
      const DBSearchPageDynamic = dynamic(async () => DBSearchPage, { ssr: false });
      export default DBSearchPageDynamic;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet inside JSX gated by a data-presence check (client-query loaded gate)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function OnboardingModal({ step }) {
        const { data: connections } = useConnections();
        return (
          <Modal opened={step != null}>
            {step === 'connection' && connections != null && (
              <ConnectionForm host={IS_CLICKHOUSE_BUILD ? window.location.origin : 'http://localhost:8123'} />
            )}
          </Modal>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet after an early return rejecting undefined data (webstudio clone-button idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `export const CloneButton = () => {
        const authToken = useStore($authToken);
        if (authToken === undefined) {
          return;
        }
        return <Link href={cloneProjectUrl({ origin: window.origin, sourceAuthToken: authToken })}>Clone</Link>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet behind a same-file alias of a nullish comparison (cloneIsExternal idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function Menu({ authToken }) {
        const cloneIsExternal = authToken !== undefined;
        return <div>{cloneIsExternal ? <a href={cloneProjectUrl({ origin: window.origin })}>Clone</a> : 'Clone'}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet inside JSX gated by a falsy-initial useState flag (add-connection idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function ConnectionsSection() {
        const [isCreatingConnection, setIsCreatingConnection] = useState(false);
        return (
          <div>
            <button onClick={() => setIsCreatingConnection(true)}>Add Connection</button>
            {isCreatingConnection && <ConnectionForm host={window.location.origin} />}
          </div>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for reads guarded by typeof of a member rooted at a browser global (save-shortcut idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function SaveShortcut() {
        return (
          <p>
            {typeof navigator.userAgent !== 'undefined'
              ? /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
                ? '⌘+s'
                : 'ctrl+s'
              : 'ctrl+s'}
          </p>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet behind a guard function whose body references a dom-guard-named flag (isClientSide idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const isSSR = typeof window === 'undefined';
      const isClientSide = () => !isSSR;
      export function useBodyRect(options = {}) {
        return useElementRect({ ...options, element: isClientSide() ? document.body : null });
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for a read directly inside interaction-mounted overlay content", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function Menu({ authToken }) {
        return (
          <DropdownMenu>
            <DropdownMenuContent>
              <a href={cloneProjectUrl({ origin: window.origin, sourceAuthToken: authToken })}>Clone</a>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in a component rendered only inside overlay content in the same file (asset-info idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const AssetInfoContent = ({ asset }) => (
        <IconButton as="a" href={getAssetUrl(asset, window.location.origin).href} />
      );
      export const AssetInfo = ({ asset }) => (
        <Popover>
          <PopoverTrigger>open</PopoverTrigger>
          <PopoverContent>
            <AssetInfoContent asset={asset} />
          </PopoverContent>
        </Popover>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a bare document.getElementById in a render body (bottom-sheet container idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function BottomSheet({ containerId, children }) {
        let container = document.getElementById(containerId);
        return <Drawer container={container}>{children}</Drawer>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags document.body behind a non-visibility boolean prop default (menuIsPortal idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `const Select = ({ menuIsPortal = false, ...props }) => {
        const menuPortalTarget = menuIsPortal ? document.body : undefined;
        return <DataDrivenSelect menuPortalTarget={menuPortalTarget} {...props} />;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a read behind an imported build-time flag ternary (placeholder idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `import { IS_CLICKHOUSE_BUILD } from '@/config';
      function ConnectionForm() {
        return <Input placeholder={IS_CLICKHOUSE_BUILD ? window.location.origin : 'http://localhost:8123'} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags navigator.userAgent seeding state at the top of a component body (browser-warning idiom)", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `export default function BrowserWarning() {
        const isFbAgent = /FBAN|FBAV/i.test(navigator.userAgent);
        const [open, setOpen] = useState(isFbAgent);
        return <AlertDialog open={open} onOpenChange={setOpen} />;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a read gated by a truthy-initial useState flag", () => {
    const result = runRule(
      noUnguardedBrowserGlobalInRenderOrHookInit,
      `function Banner() {
        const [expanded, setExpanded] = useState(true);
        return <div>{expanded && window.location.href}</div>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  describe("cross-file imported guards", () => {
    let temporaryDirectory = "";

    beforeEach(() => {
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-browser-global-render-"));
    });

    afterEach(() => {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    const createProjectFile = (relativePath: string, contents: string): string => {
      const absolutePath = path.join(temporaryDirectory, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, contents);
      return absolutePath;
    };

    const componentFilename = (): string => path.join(temporaryDirectory, "src", "App.tsx");

    const guardedByImportedConst = `import { canUseDOM } from "./env";
      export function App() {
        const width = canUseDOM ? window.innerWidth : 0;
        return <div style={{ width }} />;
      }`;

    it("stays quiet behind an imported canUseDOM const whose foreign initializer is a typeof-window check", () => {
      createProjectFile("src/env.ts", `export const canUseDOM = typeof window !== "undefined";\n`);
      const result = runRule(noUnguardedBrowserGlobalInRenderOrHookInit, guardedByImportedConst, {
        filename: componentFilename(),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("stays quiet behind an imported off-list guard name once its typeof-window initializer resolves", () => {
      createProjectFile(
        "src/env.ts",
        `export const browserReady = typeof window !== "undefined";\n`,
      );
      const result = runRule(
        noUnguardedBrowserGlobalInRenderOrHookInit,
        `import { browserReady } from "./env";
        export function App() {
          const width = browserReady ? window.innerWidth : 0;
          return <div style={{ width }} />;
        }`,
        { filename: componentFilename() },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("still flags when the imported canUseDOM resolves to a non-typeof initializer (name alone no longer vouches)", () => {
      createProjectFile("src/env.ts", `export const canUseDOM = true;\n`);
      const result = runRule(noUnguardedBrowserGlobalInRenderOrHookInit, guardedByImportedConst, {
        filename: componentFilename(),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("stays quiet behind an imported guard function whose body returns a typeof-window check", () => {
      createProjectFile(
        "src/env.ts",
        `export const canUseDOM = () => typeof window !== "undefined";\n`,
      );
      const result = runRule(
        noUnguardedBrowserGlobalInRenderOrHookInit,
        `import { canUseDOM } from "./env";
        export function App() {
          const width = canUseDOM() ? window.innerWidth : 0;
          return <div style={{ width }} />;
        }`,
        { filename: componentFilename() },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("mirrors the polarity-blind same-file alias behavior for an imported negated flag", () => {
      createProjectFile("src/env.ts", `export const serverEnv = typeof window === "undefined";\n`);
      const result = runRule(
        noUnguardedBrowserGlobalInRenderOrHookInit,
        `import { serverEnv } from "./env";
        export function App() {
          const width = serverEnv ? 0 : window.innerWidth;
          return <div style={{ width }} />;
        }`,
        { filename: componentFilename() },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("keeps the guard-name fallback when the import does not resolve", () => {
      const result = runRule(
        noUnguardedBrowserGlobalInRenderOrHookInit,
        `import { canUseDOM } from "./missing-env";
        export function App() {
          const width = canUseDOM ? window.innerWidth : 0;
          return <div style={{ width }} />;
        }`,
        { filename: componentFilename() },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("still flags an unresolvable imported non-guard flag (unresolved never becomes a guard)", () => {
      const result = runRule(
        noUnguardedBrowserGlobalInRenderOrHookInit,
        `import { IS_CLICKHOUSE_BUILD } from "./missing-env";
        export function App() {
          const width = IS_CLICKHOUSE_BUILD ? window.innerWidth : 0;
          return <div style={{ width }} />;
        }`,
        { filename: componentFilename() },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("keeps the guard-name fallback when the host provides no filename", () => {
      createProjectFile("src/env.ts", `export const canUseDOM = true;\n`);
      const result = runRule(noUnguardedBrowserGlobalInRenderOrHookInit, guardedByImportedConst, {
        filename: undefined,
        forceJsx: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });
});
