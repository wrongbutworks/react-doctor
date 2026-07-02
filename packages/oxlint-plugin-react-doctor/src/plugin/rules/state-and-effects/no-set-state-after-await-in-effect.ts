import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import { functionBodyHasReturnWithValue } from "../../utils/function-body-has-return-with-value.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookBindingInScope } from "../../utils/is-hook-binding-in-scope.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  "This setter runs after `await`, so overlapping re-runs of the effect can resolve out of order and write stale state; gate it behind a cancellation/ignore flag or return a cleanup that cancels the work.";

const STATE_DISPATCHER_HOOKS = new Set(["useState", "useReducer"]);
const STABLE_IDENTITY_HOOK = "useRef";
const EXTERNAL_STORE_HOOK_PATTERN = /^use(?:[A-Z][A-Za-z0-9]*)?Store$/;
// Hooks whose result identity is stable for the component's lifetime
// (react-router's navigate, redux dispatch, react-query's client) — a deps
// array of only these is de-facto mount-only, so overlapping re-runs cannot
// occur. Corpus-verified: NextChat's `[navigate]` effect.
const STABLE_RESULT_HOOKS = new Set(["useNavigate", "useDispatch", "useQueryClient"]);

// Cancellation / mounted-guard idioms. When the awaiting scope reads any of
// these we assume the developer already guards the post-await write, so we
// stay quiet — false positives are worse than the occasional missed case.
const CANCELLATION_GUARD_PATTERN =
  /^(?:is|has|did|was)?_?(?:mount|unmount|cancel|abort|ignore|stale|dispos|destroy|alive|signal|active)/i;

const getDependencyArray = (
  effectCall: EsTreeNodeOfType<"CallExpression">,
): EsTreeNodeOfType<"ArrayExpression"> | null => {
  const dependencyArgument = effectCall.arguments?.[1];
  if (!dependencyArgument || !isNodeOfType(dependencyArgument, "ArrayExpression")) return null;
  return dependencyArgument;
};

const doesBindingPatternBindName = (pattern: unknown, bindingName: string): boolean => {
  if (isNodeOfType(pattern, "Identifier")) return pattern.name === bindingName;
  if (isNodeOfType(pattern, "ObjectPattern")) {
    return (pattern.properties ?? []).some((property) => {
      if (isNodeOfType(property, "Property")) {
        return doesBindingPatternBindName(property.value, bindingName);
      }
      if (isNodeOfType(property, "RestElement")) {
        return doesBindingPatternBindName(property.argument, bindingName);
      }
      return false;
    });
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    return (pattern.elements ?? []).some((element) =>
      doesBindingPatternBindName(element, bindingName),
    );
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    return doesBindingPatternBindName(pattern.left, bindingName);
  }
  if (isNodeOfType(pattern, "RestElement")) {
    return doesBindingPatternBindName(pattern.argument, bindingName);
  }
  return false;
};

// External-store hooks (zustand's useStore / useXxxStore) hand back action
// references that are stable for the store's lifetime, so a dep bound from
// one cannot re-trigger the effect (NotificationsView-class false positive).
const isExternalStoreHookBinding = (scopeAnchor: EsTreeNode, bindingName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = scopeAnchor;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          const storeHookCallee = declarator.init.callee;
          if (!isNodeOfType(storeHookCallee, "Identifier")) continue;
          if (!EXTERNAL_STORE_HOOK_PATTERN.test(storeHookCallee.name)) continue;
          if (doesBindingPatternBindName(declarator.id, bindingName)) return true;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

// Store hooks also select mutable data; only a dep the effect exclusively
// INVOKES is action-shaped. Any other read (argument, member base, shorthand
// spread) means the dep carries data whose identity can change per render.
const isDependencyOnlyInvokedInCallback = (
  effectCallback: EsTreeNode,
  bindingName: string,
): boolean => {
  let hasNonInvocationUse = false;
  walkAst(effectCallback, (child: EsTreeNode) => {
    if (hasNonInvocationUse) return false;
    if (!isNodeOfType(child, "Identifier") || child.name !== bindingName) return;
    const parent = child.parent;
    if (isNodeOfType(parent, "CallExpression") && parent.callee === child) return;
    if (isNodeOfType(parent, "MemberExpression") && parent.property === child && !parent.computed) {
      return;
    }
    if (
      isNodeOfType(parent, "Property") &&
      parent.key === child &&
      !parent.computed &&
      !parent.shorthand
    ) {
      return;
    }
    hasNonInvocationUse = true;
    return false;
  });
  return !hasNonInvocationUse;
};

// A module-scope `const` (or import) has one identity for the module's whole
// lifetime, so it can never re-trigger the effect. Any closer binding of the
// same name (param, local declaration) shadows it and disqualifies the dep.
const isModuleScopeConstBinding = (scopeAnchor: EsTreeNode, bindingName: string): boolean => {
  let cursor: EsTreeNode | null | undefined = scopeAnchor;
  while (cursor) {
    if (isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (isNodeOfType(statement, "ImportDeclaration")) {
          const bindsImportedName = (statement.specifiers ?? []).some((specifier) =>
            doesBindingPatternBindName(specifier.local, bindingName),
          );
          if (bindsImportedName) return true;
        }
        if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
          const bindsConstName = (statement.declarations ?? []).some((declarator) =>
            doesBindingPatternBindName(declarator.id, bindingName),
          );
          if (bindsConstName) return true;
        }
      }
      return false;
    }
    if (isFunctionLike(cursor)) {
      const isShadowedByParam = (cursor.params ?? []).some((param) =>
        doesBindingPatternBindName(param, bindingName),
      );
      if (isShadowedByParam) return false;
    }
    if (isNodeOfType(cursor, "BlockStatement")) {
      for (const statement of cursor.body ?? []) {
        if (isNodeOfType(statement, "VariableDeclaration")) {
          const isShadowedLocally = (statement.declarations ?? []).some((declarator) =>
            doesBindingPatternBindName(declarator.id, bindingName),
          );
          if (isShadowedLocally) return false;
        }
        if (
          isNodeOfType(statement, "FunctionDeclaration") &&
          isNodeOfType(statement.id, "Identifier") &&
          statement.id.name === bindingName
        ) {
          return false;
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

// A mount-only effect (empty deps) or one whose deps are all stable-identity
// bindings (useState/useReducer dispatcher, useRef box, external-store action
// reference, module-scope const) can never have overlapping re-runs, so the
// out-of-order stale-write hazard cannot occur.
const hasOnlyStableIdentityDependencies = ({
  dependencyArray,
  effectCallback,
}: {
  dependencyArray: EsTreeNodeOfType<"ArrayExpression">;
  effectCallback: EsTreeNode;
}): boolean =>
  (dependencyArray.elements ?? []).every((dependencyElement) => {
    if (!isNodeOfType(dependencyElement, "Identifier")) return false;
    return (
      isHookBindingInScope(dependencyArray, {
        bindingName: dependencyElement.name,
        hookName: STATE_DISPATCHER_HOOKS,
        destructureIndex: 1,
      }) ||
      isHookBindingInScope(dependencyArray, {
        bindingName: dependencyElement.name,
        hookName: STABLE_IDENTITY_HOOK,
      }) ||
      isHookBindingInScope(dependencyArray, {
        bindingName: dependencyElement.name,
        hookName: STABLE_RESULT_HOOKS,
      }) ||
      isModuleScopeConstBinding(dependencyArray, dependencyElement.name) ||
      (isExternalStoreHookBinding(dependencyArray, dependencyElement.name) &&
        isDependencyOnlyInvokedInCallback(effectCallback, dependencyElement.name))
    );
  });

const isStateDispatcherCall = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (!isNodeOfType(callExpression.callee, "Identifier")) return false;
  return isHookBindingInScope(callExpression, {
    bindingName: callExpression.callee.name,
    hookName: STATE_DISPATCHER_HOOKS,
    destructureIndex: 1,
  });
};

const referencesCancellationGuard = (asyncFunction: EsTreeNode): boolean => {
  let found = false;
  walkAst(asyncFunction, (child: EsTreeNode) => {
    if (found) return false;
    // A `.current` read is the ref-based mounted-guard idiom.
    if (
      (isNodeOfType(child, "Identifier") && CANCELLATION_GUARD_PATTERN.test(child.name)) ||
      (isNodeOfType(child, "MemberExpression") &&
        isNodeOfType(child.property, "Identifier") &&
        child.property.name === "current")
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const findFirstSuspensionStart = (asyncFunction: EsTreeNode): number | null => {
  let earliestSuspensionStart: number | null = null;
  walkOwnFunctionScope(asyncFunction, (node) => {
    const isSuspensionPoint =
      isNodeOfType(node, "AwaitExpression") ||
      (isNodeOfType(node, "ForOfStatement") && node.await === true);
    if (!isSuspensionPoint) return;
    const start = (node as { start?: unknown }).start;
    if (typeof start !== "number") return;
    if (earliestSuspensionStart === null || start < earliestSuspensionStart) {
      earliestSuspensionStart = start;
    }
  });
  return earliestSuspensionStart;
};

// `setMessages(prev => ({ ...prev, [key]: value }))` — a functional updater
// that MERGES into its own previous-state parameter is order-independent
// cache accumulation: a late resolution adds its own key and cannot clobber
// a newer run's state. Replace-shaped updaters (`() => fetched`) still flag.
const isMergeShapedFunctionalUpdater = (
  setterCall: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const updater = setterCall.arguments?.[0];
  if (!isFunctionLike(updater)) return false;
  const previousStateParam = updater.params?.[0];
  if (!isNodeOfType(previousStateParam, "Identifier")) return false;
  let body: EsTreeNode = updater.body as EsTreeNode;
  if (isNodeOfType(body, "BlockStatement")) {
    const statements = body.body ?? [];
    if (statements.length !== 1) return false;
    const only = statements[0];
    if (!isNodeOfType(only, "ReturnStatement") || !only.argument) return false;
    body = only.argument as EsTreeNode;
  }
  body = stripParenExpression(body);
  if (!isNodeOfType(body, "ObjectExpression")) return false;
  return (body.properties ?? []).some(
    (property) =>
      isNodeOfType(property, "SpreadElement") &&
      isNodeOfType(property.argument, "Identifier") &&
      property.argument.name === previousStateParam.name,
  );
};

// The awaiting async scope is a stale-write hazard when a state setter
// finishes lexically after the first suspension point (`await` or
// `for await...of`) in that same scope. Comparing the setter's END offset
// also catches `setData(await load())`, where the setter call starts before
// the await nested in its own arguments but still executes after it.
const hasPostAwaitStateSetter = (asyncFunction: EsTreeNode): boolean => {
  const firstSuspensionStart = findFirstSuspensionStart(asyncFunction);
  if (firstSuspensionStart === null) return false;

  let hasLaterSetter = false;
  walkOwnFunctionScope(asyncFunction, (node) => {
    if (hasLaterSetter) return;
    if (!isNodeOfType(node, "CallExpression")) return;
    if (!isStateDispatcherCall(node)) return;
    if (isMergeShapedFunctionalUpdater(node)) return;
    const setterEnd = (node as { end?: unknown }).end;
    if (typeof setterEnd !== "number") return;
    if (setterEnd > firstSuspensionStart) hasLaterSetter = true;
  });
  return hasLaterSetter;
};

// `const [fetching, setFetching] = useState(...)` — resolves the paired
// setter name for a useState VALUE binding.
const findPairedUseStateSetterName = (
  scopeAnchor: EsTreeNode,
  valueName: string,
): string | null => {
  let cursor: EsTreeNode | null | undefined = scopeAnchor;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          const hookCallee = declarator.init.callee;
          if (!isNodeOfType(hookCallee, "Identifier") || hookCallee.name !== "useState") continue;
          if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
          const [valueElement, setterElement] = declarator.id.elements ?? [];
          if (
            isNodeOfType(valueElement, "Identifier") &&
            valueElement.name === valueName &&
            isNodeOfType(setterElement, "Identifier")
          ) {
            return setterElement.name;
          }
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

const containsBooleanLiteralAssignmentTo = (root: EsTreeNode, bindingName: string): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child.operator === "=" &&
      isNodeOfType(child.left, "Identifier") &&
      child.left.name === bindingName &&
      isNodeOfType(child.right, "Literal") &&
      typeof child.right.value === "boolean"
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

const containsSetterCallWithBooleanLiteral = (root: EsTreeNode, setterName: string): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      child.callee.name === setterName &&
      isNodeOfType(child.arguments?.[0], "Literal") &&
      typeof (child.arguments[0] as EsTreeNodeOfType<"Literal">).value === "boolean"
    ) {
      found = true;
      return false;
    }
  });
  return found;
};

// An in-flight mutex whose NAME doesn't match CANCELLATION_GUARD_PATTERN:
// a pre-await early-return `if` reading a binding that is boolean-latched —
// a closure/module `let` assigned boolean literals in the same async
// function (`if (IS_REQUEST_RUNNING) return; IS_REQUEST_RUNNING = true;`),
// or a useState flag whose paired setter is toggled with boolean literals
// (`if (fetching) ...; setFetching(true); await ...`). Either way at most
// one run is ever in flight, so out-of-order stale writes cannot occur.
const hasPreAwaitEarlyReturnLatch = (
  asyncFunction: EsTreeNode,
  effectCallback: EsTreeNode,
): boolean => {
  const firstSuspensionStart = findFirstSuspensionStart(asyncFunction);
  if (firstSuspensionStart === null) return false;
  let isLatched = false;
  walkOwnFunctionScope(asyncFunction, (node) => {
    if (isLatched) return;
    if (!isNodeOfType(node, "IfStatement") || node.alternate) return;
    const start = (node as { start?: unknown }).start;
    if (typeof start !== "number" || start >= firstSuspensionStart) return;
    if (!isEarlyExitStatement(node.consequent)) return;
    walkAst(node.test as EsTreeNode, (testChild: EsTreeNode) => {
      if (isLatched) return false;
      if (!isNodeOfType(testChild, "Identifier")) return;
      const parent = testChild.parent;
      if (
        isNodeOfType(parent, "MemberExpression") &&
        parent.property === testChild &&
        !parent.computed
      ) {
        return;
      }
      if (containsBooleanLiteralAssignmentTo(asyncFunction, testChild.name)) {
        isLatched = true;
        return false;
      }
      const setterName = findPairedUseStateSetterName(asyncFunction, testChild.name);
      if (setterName && containsSetterCallWithBooleanLiteral(effectCallback, setterName)) {
        isLatched = true;
        return false;
      }
    });
  });
  return isLatched;
};

export const noSetStateAfterAwaitInEffect = defineRule({
  id: "no-set-state-after-await-in-effect",
  title: "State update after await in an effect",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "In a `useEffect` whose dependencies can change, guard any setter call that runs after an `await` behind a cancellation/ignore flag, or return a cleanup that cancels the async work.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
      const callback = getEffectCallback(node);
      if (!isFunctionLike(callback)) return;
      // Async effect callbacks are owned by `no-async-effect-callback`.
      if (callback.async) return;
      const dependencyArray = getDependencyArray(node);
      if (
        dependencyArray &&
        hasOnlyStableIdentityDependencies({ dependencyArray, effectCallback: callback })
      ) {
        return;
      }
      // A cleanup return is the documented fix; stay quiet when one exists.
      if (functionBodyHasReturnWithValue(callback)) return;

      // Guard idioms may live in the callback's synchronous prologue
      // (`if (handledRef.current) return; handledRef.current = true;`)
      // rather than inside the inner async function, so scan the whole
      // effect callback, not each async scope in isolation.
      if (referencesCancellationGuard(callback)) return;

      const asyncFunctions: EsTreeNode[] = [];
      walkAst(callback, (child: EsTreeNode) => {
        if (child === callback) return;
        if (isFunctionLike(child) && child.async) asyncFunctions.push(child);
      });

      for (const asyncFunction of asyncFunctions) {
        if (hasPreAwaitEarlyReturnLatch(asyncFunction, callback)) continue;
        if (hasPostAwaitStateSetter(asyncFunction)) {
          context.report({ node, message: MESSAGE });
          return;
        }
      }
    },
  }),
});
