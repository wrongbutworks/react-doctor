import * as path from "node:path";
import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { isDomGuardIdentifierName } from "../../utils/is-dom-guard-identifier-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveCrossFileExport } from "../../utils/resolve-cross-file-export.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { RuleVisitors } from "../../utils/rule-visitors.js";

// Browser-only globals that do not exist during a Node SSR/SSG render.
// Reading one on the render path throws `ReferenceError` on the server,
// or seeds a client-only initial value that disagrees with the server
// HTML (hydration mismatch).
//
// Corpus-audited exemptions (the read provably never runs on the server):
// - browser-only-by-convention files (Remix `.client.` modules, Gatsby's
//   `cache-dir/` client runtime) and modules whose top level already
//   throws under a `typeof window === "undefined"` check;
// - components exported through `dynamic(..., { ssr: false })` in the
//   same file;
// - reads dominated by a data-presence gate (`data != null && ...`) or by
//   a state flag initialized falsy by `useState` — both are false during
//   the single-pass server render;
// - reads inside interaction-mounted overlay content (`<PopoverContent>`,
//   `<DropdownMenuContent>`, ...), directly or via a component rendered
//   only inside such content in the same file;
// - reads that are themselves `typeof` operands (the guard expression).
//
// Known accepted noise (single-file analysis cannot prove these): components
// mounted only behind cross-file `<ClientOnly>` route wrappers or
// interaction-gated parents in other files.
const BROWSER_GLOBAL_NAMES = new Set([
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "matchMedia",
]);

// Hooks whose FIRST-render function argument runs during render (so a
// browser read inside their lazy initializer is unsafe under SSR).
// `useMemo` / `useEffect` are deliberately absent, and so is `useRef` —
// React never invokes a function passed to useRef, and a bare
// `useRef(window.innerWidth)` argument is already caught by the
// component-body path.
const RENDER_TIME_INITIALIZER_HOOKS = new Set(["useState", "useReducer"]);

// Interaction-driven visibility flags (`open` / `isVisible` / `showTooltip`)
// that gate overlays: false during the initial server render, so a
// flow-terminating `if (!open) return ...` before the read makes it
// unreachable under SSR.
const VISIBILITY_GATE_NAMES = new Set([
  "open",
  "isopen",
  "opened",
  "isopened",
  "visible",
  "isvisible",
]);

// Remix/React Router `.client.` modules and Gatsby's `cache-dir/` client
// runtime are loaded exclusively in the browser bundle — never by the SSR
// entry — so render-path browser-global reads there cannot crash Node.
// NOTE: duplicated in no-unguarded-browser-global-at-module-scope (shared
// utils are frozen for this pass).
const isBrowserOnlyModuleFilename = (rawFilename: string | undefined): boolean => {
  if (!rawFilename) return false;
  const filename = rawFilename.replaceAll("\\", "/").toLowerCase();
  const basename = filename.slice(filename.lastIndexOf("/") + 1);
  if (basename.includes(".client.")) return true;
  const rootedFilename = filename.startsWith("/") ? filename : `/${filename}`;
  return rootedFilename.includes("/cache-dir/");
};

const normalizeGuardName = (name: string): string => name.toLowerCase().replace(/[_$]/g, "");

const isVisibilityGateName = (name: string): boolean => {
  const normalizedName = normalizeGuardName(name);
  if (VISIBILITY_GATE_NAMES.has(normalizedName)) return true;
  if (normalizedName.startsWith("show") || normalizedName.startsWith("isshow")) return true;
  // `navOpen`, `drawerOpened`, `tooltipVisible` — suffix-named flags that
  // gate interaction-driven subtrees (false on the initial server render).
  return (
    normalizedName.endsWith("open") ||
    normalizedName.endsWith("opened") ||
    normalizedName.endsWith("visible")
  );
};

// A dominating test that is a bare visibility-gate flag (`showConfetti &&
// <Confetti width={window.innerWidth} />`, `open ? window.innerWidth : 0`).
// These flags are false during the initial server render, so the gated
// subtree never evaluates on the server — same trust the early-return
// visibility gate already gets.
const conditionIsVisibilityGate = (condition: EsTreeNode): boolean => {
  const strippedCondition = stripParenExpression(condition);
  if (isNodeOfType(strippedCondition, "Identifier")) {
    return isVisibilityGateName(strippedCondition.name);
  }
  return (
    isNodeOfType(strippedCondition, "MemberExpression") &&
    !strippedCondition.computed &&
    isNodeOfType(strippedCondition.property, "Identifier") &&
    isVisibilityGateName(strippedCondition.property.name)
  );
};

const isBrowserGlobalIdentifier = (node: EsTreeNode): node is EsTreeNodeOfType<"Identifier"> =>
  isNodeOfType(node, "Identifier") && BROWSER_GLOBAL_NAMES.has(node.name);

// True when `identifier` is the real browser global and not a same-file
// local binding of the same name (e.g. `const navigator = useAgent()`
// or `location` from react-router's `useLocation()`).
const isTrueBrowserGlobal = (identifier: EsTreeNodeOfType<"Identifier">): boolean =>
  findVariableInitializer(identifier, identifier.name) === null;

// A function passed as the lazy-initializer argument of
// `useState` / `useReducer`.
const isRenderTimeInitializerCallback = (functionNode: EsTreeNode): boolean => {
  const parent = functionNode.parent;
  if (!parent || !isNodeOfType(parent, "CallExpression")) return false;
  if (!parent.arguments?.some((argument) => argument === functionNode)) return false;
  const calleeName = getCalleeName(parent);
  return Boolean(calleeName && RENDER_TIME_INITIALIZER_HOOKS.has(calleeName));
};

// True when `node` executes during a component/hook render: directly in
// the component/hook body, or inside a useState/useReducer lazy
// initializer within one. Reads inside effects, event handlers,
// useMemo, or any other nested callback return false.
const isOnRenderTimePath = (node: EsTreeNode): boolean => {
  const enclosingFunction = findEnclosingFunction(node);
  if (!enclosingFunction) return false;
  if (componentOrHookDisplayNameForFunction(enclosingFunction)) return true;
  if (isRenderTimeInitializerCallback(enclosingFunction)) {
    const outerFunction = findEnclosingFunction(enclosingFunction);
    return Boolean(outerFunction && componentOrHookDisplayNameForFunction(outerFunction));
  }
  return false;
};

// Roots through which a typeof check still reaches the global:
// `typeof globalThis.window`, `typeof window.matchMedia`, `typeof self.document`.
const GLOBAL_ROOT_NAMES = new Set(["globalThis", "window", "self"]);

const memberChainRoot = (node: EsTreeNode): EsTreeNode => {
  let current = stripParenExpression(node);
  while (isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object);
  }
  return current;
};

const containsTypeofBrowserGlobalCheck = (node: EsTreeNode): boolean => {
  let found = false;
  walkAst(node, (child) => {
    if (found) return false;
    if (isNodeOfType(child, "UnaryExpression") && child.operator === "typeof") {
      const argument = stripParenExpression(child.argument);
      if (isNodeOfType(argument, "Identifier") && BROWSER_GLOBAL_NAMES.has(argument.name)) {
        found = true;
        return false;
      }
      if (isNodeOfType(argument, "MemberExpression") && !argument.computed) {
        // `typeof globalThis.window` / `typeof self.document` — the
        // rooted spelling of the same check.
        if (
          isNodeOfType(argument.object, "Identifier") &&
          GLOBAL_ROOT_NAMES.has(argument.object.name) &&
          isNodeOfType(argument.property, "Identifier") &&
          BROWSER_GLOBAL_NAMES.has(argument.property.name)
        ) {
          found = true;
          return false;
        }
        // `typeof navigator.userAgent !== "undefined"` — a feature check
        // whose author is explicitly probing the browser environment.
        const root = memberChainRoot(argument);
        if (isNodeOfType(root, "Identifier") && BROWSER_GLOBAL_NAMES.has(root.name)) {
          found = true;
          return false;
        }
      }
    }
  });
  return found;
};

// How an import-bound identifier in a guard condition is classified after
// following the import into its source file:
// - "browser-guard": the export is (or boolean-derives from) a literal
//   typeof-browser-global check — a const initializer like
//   `export const canUseDOM = typeof window !== "undefined"` or a function
//   returning such a check — so it guards exactly like a same-file alias;
// - "resolved-not-guard": the export resolved to something that provably is
//   NOT an environment check (`export const canUseDOM = true`), so the
//   guard-name heuristic must not vouch for it;
// - "unresolved": the import could not be followed (relative specifier that
//   doesn't resolve, node_modules, no absolute filename, resolution budget
//   spent) — keep the current name-heuristic behavior.
type ImportedGuardResolution = "browser-guard" | "resolved-not-guard" | "unresolved";

interface ClassifyImportedGuardIdentifier {
  (identifier: EsTreeNodeOfType<"Identifier">): ImportedGuardResolution | null;
}

// NOTE: belongs in constants/thresholds.ts; shared files are frozen for
// this pass. Caps cross-file guard resolutions per linted file.
const MAX_IMPORTED_GUARD_RESOLUTIONS = 3;

// An imported guard FUNCTION (`export const canUseDOM = () => typeof window
// !== "undefined"`, exenv-style) counts when a returned expression contains
// the typeof check. Only literal typeof checks are trusted in the foreign
// body — a guard built from ANOTHER imported flag stays unproven (no
// cross-file recursion).
const functionBodyReturnsBrowserGuard = (functionNode: EsTreeNode): boolean => {
  if (
    !isNodeOfType(functionNode, "FunctionDeclaration") &&
    !isNodeOfType(functionNode, "FunctionExpression") &&
    !isNodeOfType(functionNode, "ArrowFunctionExpression")
  ) {
    return false;
  }
  const body = functionNode.body;
  if (!body) return false;
  if (!isNodeOfType(body, "BlockStatement")) return containsTypeofBrowserGlobalCheck(body);
  let returnsGuard = false;
  walkAst(body, (child) => {
    if (returnsGuard) return false;
    if (
      isNodeOfType(child, "ReturnStatement") &&
      child.argument &&
      containsTypeofBrowserGlobalCheck(child.argument)
    ) {
      returnsGuard = true;
      return false;
    }
  });
  return returnsGuard;
};

// The initializer of a same-file guard alias, one resolution level deeper:
// `const isClientSide = () => !isSSR` conveys a guard because `isSSR` is a
// dom-guard-named flag even though no `typeof window` appears literally.
const initializerConveysDomGuard = (initializer: EsTreeNode): boolean => {
  if (containsTypeofBrowserGlobalCheck(initializer)) return true;
  let found = false;
  walkAst(initializer, (child) => {
    if (found) return false;
    if (isNodeOfType(child, "Identifier") && isDomGuardIdentifierName(child.name)) {
      found = true;
      return false;
    }
  });
  return found;
};

const conditionContainsDomGuard = (
  condition: EsTreeNode,
  classifyImportedGuardIdentifier: ClassifyImportedGuardIdentifier,
): boolean => {
  if (containsTypeofBrowserGlobalCheck(condition)) return true;
  let guarded = false;
  walkAst(condition, (child) => {
    if (guarded) return false;
    if (!isNodeOfType(child, "Identifier")) return;
    const importedResolution = classifyImportedGuardIdentifier(child);
    if (importedResolution === "browser-guard") {
      guarded = true;
      return false;
    }
    // A resolved import whose export provably is NOT an environment check
    // must not be vouched for by its name (`export const canUseDOM = true`);
    // an unresolved import keeps the name-heuristic fallback below.
    if (importedResolution === "resolved-not-guard") return;
    if (isDomGuardIdentifierName(child.name)) {
      guarded = true;
      return false;
    }
    const binding = findVariableInitializer(child, child.name);
    if (binding?.initializer && initializerConveysDomGuard(binding.initializer)) {
      guarded = true;
      return false;
    }
  });
  return guarded;
};

const isNullOrUndefinedValue = (node: EsTreeNode): boolean => {
  const value = stripParenExpression(node);
  if (isNodeOfType(value, "Identifier")) return value.name === "undefined";
  return isNodeOfType(value, "Literal") && value.value === null;
};

const isNullishComparison = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "BinaryExpression") &&
  (node.operator === "==" ||
    node.operator === "===" ||
    node.operator === "!=" ||
    node.operator === "!==") &&
  (isNullOrUndefinedValue(node.left) || isNullOrUndefinedValue(node.right));

// A dominating test that compares a value against null/undefined
// (`connections != null && ...`, `if (authToken === undefined) return`) is
// a data-presence gate: the compared value is client-loaded data (queries,
// stores) that is absent during the server render, so the gated subtree
// never evaluates there. One level of same-file alias resolution covers
// `const cloneIsExternal = authToken !== undefined`.
const conditionContainsDataPresenceCheck = (condition: EsTreeNode): boolean => {
  let found = false;
  walkAst(condition, (child) => {
    if (found) return false;
    if (isNullishComparison(child)) {
      found = true;
      return false;
    }
    if (!isNodeOfType(child, "Identifier")) return;
    const binding = findVariableInitializer(child, child.name);
    if (!binding?.initializer) return;
    let aliasFound = false;
    walkAst(binding.initializer, (aliasChild) => {
      if (aliasFound) return false;
      if (isNullishComparison(aliasChild)) {
        aliasFound = true;
        return false;
      }
    });
    if (aliasFound) {
      found = true;
      return false;
    }
  });
  return found;
};

const isFalsyLiteralExpression = (node: EsTreeNode): boolean => {
  const value = stripParenExpression(node);
  if (isNodeOfType(value, "Identifier")) return value.name === "undefined";
  return (
    isNodeOfType(value, "Literal") &&
    (value.value === false || value.value === 0 || value.value === "" || value.value === null)
  );
};

// A bare state flag whose `useState` initial value is falsy (or absent)
// can only become truthy through a client-side state update — the
// single-pass server render always sees the initial value, so the gated
// subtree provably never evaluates during SSR.
const conditionIsFalsyInitialStateFlag = (condition: EsTreeNode): boolean => {
  const flag = stripParenExpression(condition);
  if (!isNodeOfType(flag, "Identifier")) return false;
  const binding = findVariableInitializer(flag, flag.name);
  if (!binding) return false;
  const pattern = binding.bindingIdentifier.parent;
  if (!pattern || !isNodeOfType(pattern, "ArrayPattern")) return false;
  if (pattern.elements?.[0] !== binding.bindingIdentifier) return false;
  const declarator = pattern.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
    return false;
  }
  const stateCall = stripParenExpression(declarator.init);
  if (!isNodeOfType(stateCall, "CallExpression") || getCalleeName(stateCall) !== "useState") {
    return false;
  }
  const initialValue = stateCall.arguments?.[0];
  if (!initialValue) return true;
  const strippedInitialValue = stripParenExpression(initialValue);
  if (isNodeOfType(strippedInitialValue, "ArrowFunctionExpression")) {
    return (
      !isNodeOfType(strippedInitialValue.body, "BlockStatement") &&
      isFalsyLiteralExpression(strippedInitialValue.body)
    );
  }
  return isFalsyLiteralExpression(strippedInitialValue);
};

// A statement after which control cannot fall through to the next
// sibling — the shapes an SSR early-return guard body takes.
const isFlowTerminatingStatement = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "ReturnStatement") || isNodeOfType(statement, "ThrowStatement")) {
    return true;
  }
  if (isNodeOfType(statement, "BlockStatement")) {
    const lastStatement = statement.body[statement.body.length - 1];
    return Boolean(lastStatement && isFlowTerminatingStatement(lastStatement));
  }
  return false;
};

// `if (!open) ...` / `if (!props.showTooltip) ...` — the negated
// visibility flag that gates overlay render paths off during SSR.
const isNegatedVisibilityGateCondition = (condition: EsTreeNode): boolean => {
  const strippedCondition = stripParenExpression(condition);
  if (!isNodeOfType(strippedCondition, "UnaryExpression") || strippedCondition.operator !== "!") {
    return false;
  }
  const negatedValue = stripParenExpression(strippedCondition.argument);
  if (isNodeOfType(negatedValue, "Identifier")) {
    return isVisibilityGateName(negatedValue.name);
  }
  return (
    isNodeOfType(negatedValue, "MemberExpression") &&
    isNodeOfType(negatedValue.property, "Identifier") &&
    isVisibilityGateName(negatedValue.property.name)
  );
};

// An earlier sibling `if (typeof window === 'undefined') return null;`
// (or `if (!mounted) return null;` / `if (!open) return null;` /
// `if (authToken === undefined) return;`) dominates every statement
// after it.
const hasDomGuardEarlyReturnBefore = (
  block: EsTreeNodeOfType<"BlockStatement">,
  statement: EsTreeNode,
  classifyImportedGuardIdentifier: ClassifyImportedGuardIdentifier,
): boolean => {
  for (const sibling of block.body) {
    if (sibling === statement) return false;
    if (
      isNodeOfType(sibling, "IfStatement") &&
      isFlowTerminatingStatement(sibling.consequent) &&
      (conditionContainsDomGuard(sibling.test, classifyImportedGuardIdentifier) ||
        isNegatedVisibilityGateCondition(sibling.test) ||
        conditionContainsDataPresenceCheck(sibling.test))
    ) {
      return true;
    }
  }
  return false;
};

// A read anywhere inside an argument of `createPortal(...)` (the
// `document.body` container idiom). Portal-returning render paths are
// gated client-side in practice, and an ungated portal already breaks
// the server render on its own — the browser-global read is not the
// signal there.
const isInsideCreatePortalArgument = (node: EsTreeNode): boolean => {
  let previous: EsTreeNode = node;
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "CallExpression") &&
      getCalleeName(ancestor) === "createPortal" &&
      Boolean(ancestor.arguments?.some((argument) => argument === previous))
    ) {
      return true;
    }
    previous = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// A dominating test that renders the subtree only when a browser
// environment, visible overlay, loaded client data, or post-interaction
// state flag is present — all false during the server render.
const testConveysSsrSafeGate = (
  test: EsTreeNode,
  classifyImportedGuardIdentifier: ClassifyImportedGuardIdentifier,
): boolean =>
  conditionContainsDomGuard(test, classifyImportedGuardIdentifier) ||
  conditionIsVisibilityGate(test) ||
  conditionContainsDataPresenceCheck(test) ||
  conditionIsFalsyInitialStateFlag(test);

// True when a `typeof window`/`canUseDOM`/`isMounted` check dominates
// the read via an enclosing `if` / ternary / `&&`, a preceding
// early-return guard, or a wrapping `try` with a catch handler (the
// persisted-state idiom that swallows the server ReferenceError).
// Conservative: any such guard suppresses the report.
const isDominatedByDomGuard = (
  node: EsTreeNode,
  classifyImportedGuardIdentifier: ClassifyImportedGuardIdentifier,
): boolean => {
  let previous: EsTreeNode = node;
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      testConveysSsrSafeGate(ancestor.test, classifyImportedGuardIdentifier)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "ConditionalExpression") &&
      testConveysSsrSafeGate(ancestor.test, classifyImportedGuardIdentifier)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      testConveysSsrSafeGate(ancestor.left, classifyImportedGuardIdentifier)
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "TryStatement") && ancestor.handler && ancestor.block === previous) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "BlockStatement") &&
      hasDomGuardEarlyReturnBefore(ancestor, previous, classifyImportedGuardIdentifier)
    ) {
      return true;
    }
    previous = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// A top-level `if (typeof window === "undefined") { throw new Error(...) }`
// (the Gatsby loading-indicator idiom) is the module declaring itself
// browser-only, so every render in it happens with `window` defined.
const moduleDeclaresBrowserOnly = (program: EsTreeNodeOfType<"Program">): boolean =>
  (program.body ?? []).some(
    (statement) =>
      isNodeOfType(statement, "IfStatement") &&
      isFlowTerminatingStatement(statement.consequent) &&
      containsTypeofBrowserGlobalCheck(statement.test),
  );

// Component names referenced inside the loader argument of a
// `dynamic(..., { ssr: false })` call — Next.js never server-renders
// those components, so browser reads in their render path are safe.
const collectSsrDisabledComponentNames = (program: EsTreeNodeOfType<"Program">): Set<string> => {
  const names = new Set<string>();
  walkAst(program, (node) => {
    if (!isNodeOfType(node, "CallExpression") || getCalleeName(node) !== "dynamic") return;
    const optionsArgument = node.arguments?.find((argument) =>
      isNodeOfType(stripParenExpression(argument), "ObjectExpression"),
    );
    if (!optionsArgument) return;
    const options = stripParenExpression(optionsArgument);
    if (!isNodeOfType(options, "ObjectExpression")) return;
    const disablesSsr = options.properties?.some((property) => {
      if (!isNodeOfType(property, "Property") || property.computed) return false;
      if (!isNodeOfType(property.key, "Identifier") || property.key.name !== "ssr") return false;
      const propertyValue = stripParenExpression(property.value);
      return isNodeOfType(propertyValue, "Literal") && propertyValue.value === false;
    });
    if (!disablesSsr) return;
    for (const argument of node.arguments ?? []) {
      if (argument === optionsArgument) continue;
      walkAst(argument, (loaderChild) => {
        if (isNodeOfType(loaderChild, "Identifier")) names.add(loaderChild.name);
      });
    }
  });
  return names;
};

const jsxElementName = (element: EsTreeNodeOfType<"JSXElement">): string | null => {
  let nameNode = element.openingElement?.name;
  const segments: string[] = [];
  while (nameNode) {
    if (isNodeOfType(nameNode, "JSXIdentifier")) {
      segments.unshift(nameNode.name);
      break;
    }
    if (isNodeOfType(nameNode, "JSXMemberExpression")) {
      if (isNodeOfType(nameNode.property, "JSXIdentifier")) {
        segments.unshift(nameNode.property.name);
      }
      nameNode = nameNode.object;
      continue;
    }
    return null;
  }
  return segments.length > 0 ? segments.join("") : null;
};

// Radix/shadcn-style overlay content (`<PopoverContent>`, `<Popover.Content>`,
// `<DropdownMenuContent>`) mounts only after the user opens the trigger —
// never during the server render.
const OVERLAY_CONTENT_NAME_PATTERN =
  /(?:Popover|DropdownMenu|Dropdown|ContextMenu|Menubar|Menu|HoverCard|Tooltip|AlertDialog|Dialog|Sheet|Drawer|Modal|Select|Combobox|Overlay)Content$/;

const hasOverlayContentJsxAncestor = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const elementName = jsxElementName(ancestor);
      if (elementName && OVERLAY_CONTENT_NAME_PATTERN.test(elementName)) return true;
    }
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

const enclosingComponentOrHookDisplayNames = (node: EsTreeNode): Set<string> => {
  const displayNames = new Set<string>();
  let functionNode = findEnclosingFunction(node);
  while (functionNode) {
    const displayName = componentOrHookDisplayNameForFunction(functionNode);
    if (displayName) displayNames.add(displayName);
    functionNode = findEnclosingFunction(functionNode);
  }
  return displayNames;
};

// True when every same-file JSX usage of `componentName` sits inside
// interaction-mounted overlay content (and at least one usage exists) —
// the component provably renders only after the overlay opens.
const isRenderedOnlyInsideOverlayContent = (
  program: EsTreeNodeOfType<"Program">,
  componentName: string,
): boolean => {
  let usageCount = 0;
  let allUsagesInsideOverlay = true;
  walkAst(program, (node) => {
    if (!allUsagesInsideOverlay) return false;
    if (!isNodeOfType(node, "JSXElement")) return;
    if (jsxElementName(node) !== componentName) return;
    usageCount += 1;
    if (!hasOverlayContentJsxAncestor(node)) allUsagesInsideOverlay = false;
  });
  return usageCount > 0 && allUsagesInsideOverlay;
};

export const noUnguardedBrowserGlobalInRenderOrHookInit = defineRule({
  id: "no-unguarded-browser-global-in-render-or-hook-init",
  title: "Browser global read during render or hook init",
  severity: "warn",
  category: "Correctness",
  requires: ["ssr"],
  recommendation:
    'Reading `window`/`document`/`navigator`/`localStorage`/`sessionStorage` during render or in a useState/useReducer/useRef initializer crashes the server render and causes hydration mismatches. Guard the read with `typeof window !== "undefined"` (e.g. a lazy initializer that falls back on the server), or read the browser global inside a useEffect after mount.',
  create: (context: RuleContext): RuleVisitors => {
    if (isBrowserOnlyModuleFilename(context.filename)) return {};

    let moduleIsDeclaredBrowserOnly = false;
    let ssrDisabledComponentNames: ReadonlySet<string> = new Set<string>();
    let programRoot: EsTreeNodeOfType<"Program"> | null = null;
    const overlayOnlyComponentCache = new Map<string, boolean>();

    const importedGuardResolutionByName = new Map<string, ImportedGuardResolution>();
    let importedGuardResolutionCount = 0;

    const classifyImportedGuardIdentifier: ClassifyImportedGuardIdentifier = (identifier) => {
      const importBinding = getImportBindingForName(identifier, identifier.name);
      if (!importBinding || importBinding.isNamespace || !importBinding.exportedName) return null;
      // Scope-aware confirmation: a local binding (parameter, destructure,
      // const) shadowing the import must not inherit the import's verdict.
      const scopeBinding = findVariableInitializer(identifier, identifier.name);
      const scopeBindingParent = scopeBinding?.bindingIdentifier.parent;
      if (
        !scopeBindingParent ||
        (!isNodeOfType(scopeBindingParent, "ImportSpecifier") &&
          !isNodeOfType(scopeBindingParent, "ImportDefaultSpecifier"))
      ) {
        return null;
      }
      const cachedResolution = importedGuardResolutionByName.get(identifier.name);
      if (cachedResolution) return cachedResolution;
      const filename = context.filename;
      if (!filename || !path.isAbsolute(filename)) return "unresolved";
      if (importedGuardResolutionCount >= MAX_IMPORTED_GUARD_RESOLUTIONS) return "unresolved";
      importedGuardResolutionCount += 1;
      const resolvedExport = resolveCrossFileExport(
        filename,
        importBinding.source,
        importBinding.exportedName,
      );
      let resolution: ImportedGuardResolution = "unresolved";
      if (resolvedExport?.kind === "initializer") {
        resolution = containsTypeofBrowserGlobalCheck(resolvedExport.node)
          ? "browser-guard"
          : "resolved-not-guard";
      } else if (resolvedExport?.kind === "function") {
        resolution = functionBodyReturnsBrowserGuard(resolvedExport.node)
          ? "browser-guard"
          : "resolved-not-guard";
      }
      importedGuardResolutionByName.set(identifier.name, resolution);
      return resolution;
    };

    const isComponentRenderedOnlyInsideOverlayContent = (componentName: string): boolean => {
      if (!programRoot) return false;
      let cached = overlayOnlyComponentCache.get(componentName);
      if (cached === undefined) {
        cached = isRenderedOnlyInsideOverlayContent(programRoot, componentName);
        overlayOnlyComponentCache.set(componentName, cached);
      }
      return cached;
    };

    const reportRead = (readNode: EsTreeNode, globalName: string): void => {
      if (moduleIsDeclaredBrowserOnly) return;
      if (!isOnRenderTimePath(readNode)) return;
      if (isDominatedByDomGuard(readNode, classifyImportedGuardIdentifier)) return;
      if (isInsideCreatePortalArgument(readNode)) return;
      if (hasOverlayContentJsxAncestor(readNode)) return;
      const displayNames = enclosingComponentOrHookDisplayNames(readNode);
      for (const displayName of displayNames) {
        if (ssrDisabledComponentNames.has(displayName)) return;
        if (isComponentRenderedOnlyInsideOverlayContent(displayName)) return;
      }
      context.report({
        node: readNode,
        message: `Reading \`${globalName}\` during render or in a useState/useReducer/useRef initializer crashes SSR ("${globalName} is not defined") and causes hydration mismatches. Seed a stable default and read \`${globalName}\` inside a useEffect after mount, or guard it with \`typeof ${globalName} !== "undefined"\`.`,
      });
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        programRoot = node;
        moduleIsDeclaredBrowserOnly = moduleDeclaresBrowserOnly(node);
        ssrDisabledComponentNames = collectSsrDisabledComponentNames(node);
      },
      MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
        const object = stripParenExpression(node.object);
        if (!isBrowserGlobalIdentifier(object) || !isTrueBrowserGlobal(object)) return;
        reportRead(node, object.name);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        // Bare `matchMedia(...)` — the member form `window.matchMedia`
        // is already covered by the MemberExpression visitor.
        const callee = stripParenExpression(node.callee);
        if (!isBrowserGlobalIdentifier(callee) || !isTrueBrowserGlobal(callee)) return;
        reportRead(callee, callee.name);
      },
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        // `const { innerWidth } = window` / `const win = window` reads
        // the global during render just like a member access.
        if (!node.init) return;
        const initializer = stripParenExpression(node.init);
        if (!isBrowserGlobalIdentifier(initializer) || !isTrueBrowserGlobal(initializer)) return;
        reportRead(initializer, initializer.name);
      },
    };
  },
});
