import { componentOrHookDisplayNameForFunction } from "../../utils/component-or-hook-display-name.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const DOM_QUERY_METHODS = new Set(["getElementById", "querySelector", "querySelectorAll"]);
const CLASS_LIST_MUTATION_METHODS = new Set(["add", "remove", "toggle", "replace"]);
// App-shell / third-party roots are never a component's own reconciled subtree.
const EXCLUDED_QUERY_TOKENS = new Set(["root", "__next"]);

interface OwnedTokens {
  ids: Set<string>;
  classNames: Set<string>;
  testIds: Set<string>;
}

interface QueryTarget {
  kind: "id" | "class" | "testid";
  value: string;
}

const literalStringFromJsxAttributeValue = (
  value: EsTreeNode | null | undefined,
): string | null => {
  if (!value) return null;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") return value.value;
  if (isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return expression.value;
    }
  }
  return null;
};

// Collects the literal id / className / data-testid tokens the file's JSX
// renders. The ownership link — a queried selector must match one of these —
// is what proves a mutated node is React-owned by this file, suppressing the
// portal / third-party / non-React node false positives.
const collectOwnedTokens = (programRoot: EsTreeNode): OwnedTokens => {
  const owned: OwnedTokens = {
    ids: new Set(),
    classNames: new Set(),
    testIds: new Set(),
  };
  walkAst(programRoot, (node: EsTreeNode) => {
    if (!isNodeOfType(node, "JSXAttribute")) return;
    const attributeName = getJsxAttributeName(node.name);
    if (!attributeName) return;
    const value = literalStringFromJsxAttributeValue(node.value);
    if (value === null) return;
    if (attributeName === "id") {
      owned.ids.add(value);
    } else if (attributeName === "className" || attributeName === "class") {
      for (const className of value.split(/\s+/)) {
        if (className) owned.classNames.add(className);
      }
    } else if (attributeName === "data-testid") {
      owned.testIds.add(value);
    }
  });
  return owned;
};

const parseSelectorTarget = (selector: string): QueryTarget | null => {
  const idMatch = /^#([\w-]+)$/.exec(selector);
  if (idMatch) return { kind: "id", value: idMatch[1] };
  const classMatch = /^\.([\w-]+)$/.exec(selector);
  if (classMatch) return { kind: "class", value: classMatch[1] };
  const testIdMatch = /^\[data-testid=["']([^"']+)["']\]$/.exec(selector);
  if (testIdMatch) return { kind: "testid", value: testIdMatch[1] };
  return null;
};

// The static id / selector a `document.getElementById/querySelector(All)(...)`
// call targets, or null when the argument isn't a static string or the callee
// isn't a literal `document` query.
const queryCallTarget = (node: EsTreeNode): QueryTarget | null => {
  const stripped = stripParenExpression(node);
  if (!isNodeOfType(stripped, "CallExpression")) return null;
  const callee = stripped.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "document") return null;
  if (
    !isNodeOfType(callee.property, "Identifier") ||
    !DOM_QUERY_METHODS.has(callee.property.name)
  ) {
    return null;
  }
  const argument = stripped.arguments?.[0];
  if (!isNodeOfType(argument, "Literal") || typeof argument.value !== "string") return null;
  if (callee.property.name === "getElementById") return { kind: "id", value: argument.value };
  return parseSelectorTarget(argument.value);
};

const isOwnedQueryTarget = (target: QueryTarget | null, owned: OwnedTokens): boolean => {
  if (!target || EXCLUDED_QUERY_TOKENS.has(target.value)) return false;
  if (target.kind === "id") return owned.ids.has(target.value);
  if (target.kind === "class") return owned.classNames.has(target.value);
  return owned.testIds.has(target.value);
};

// `X.style.<prop>` / `X.style.cssText` → the mutated node `X`, else null.
const styleAssignmentReceiver = (assignmentTarget: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(assignmentTarget, "MemberExpression")) return null;
  const object = assignmentTarget.object;
  if (
    isNodeOfType(object, "MemberExpression") &&
    !object.computed &&
    isNodeOfType(object.property, "Identifier") &&
    object.property.name === "style"
  ) {
    return object.object;
  }
  return null;
};

// `X.classList.add|remove|toggle|replace(...)` → the mutated node `X`, else null.
const classListMutationReceiver = (callee: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier")) return null;
  if (!CLASS_LIST_MUTATION_METHODS.has(callee.property.name)) return null;
  const object = callee.object;
  if (
    isNodeOfType(object, "MemberExpression") &&
    !object.computed &&
    isNodeOfType(object.property, "Identifier") &&
    object.property.name === "classList"
  ) {
    return object.object;
  }
  return null;
};

// `X.style.setProperty(...)` → the mutated node `X`, else null.
const stylePropertyCallReceiver = (callee: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "setProperty") {
    return null;
  }
  const object = callee.object;
  if (
    isNodeOfType(object, "MemberExpression") &&
    !object.computed &&
    isNodeOfType(object.property, "Identifier") &&
    object.property.name === "style"
  ) {
    return object.object;
  }
  return null;
};

const collectPatternIdentifiers = (
  pattern: EsTreeNode | null | undefined,
  visit: (identifier: EsTreeNodeOfType<"Identifier">) => void,
): void => {
  if (!pattern) return;
  if (isNodeOfType(pattern, "Identifier")) {
    visit(pattern);
    return;
  }
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    collectPatternIdentifiers(pattern.left, visit);
    return;
  }
  if (isNodeOfType(pattern, "RestElement")) {
    collectPatternIdentifiers(pattern.argument, visit);
    return;
  }
  if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements) {
      collectPatternIdentifiers(element, visit);
    }
    return;
  }
  if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties) {
      if (isNodeOfType(property, "Property")) {
        collectPatternIdentifiers(property.value, visit);
      } else if (isNodeOfType(property, "RestElement")) {
        collectPatternIdentifiers(property.argument, visit);
      }
    }
  }
};

// `document.querySelectorAll('.owned').forEach((row) => ...)` → the callback
// parameter that binds each owned node, else null.
const ownedNodeListCallbackParam = (
  node: EsTreeNode,
  owned: OwnedTokens,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (!isNodeOfType(node, "CallExpression")) return null;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return null;
  if (!isNodeOfType(callee.property, "Identifier") || callee.property.name !== "forEach") {
    return null;
  }
  if (!isOwnedQueryTarget(queryCallTarget(callee.object), owned)) return null;
  const callbackArgument = node.arguments[0];
  if (!callbackArgument) return null;
  const callback = stripParenExpression(callbackArgument);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") &&
    !isNodeOfType(callback, "FunctionExpression")
  ) {
    return null;
  }
  const firstParam = callback.params[0];
  return isNodeOfType(firstParam, "Identifier") ? firstParam : null;
};

// `for (const row of document.querySelectorAll('.owned'))` → the loop
// binding that holds each owned node, else null.
const ownedNodeListLoopBinding = (
  node: EsTreeNode,
  owned: OwnedTokens,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (!isNodeOfType(node, "ForOfStatement")) return null;
  if (!isOwnedQueryTarget(queryCallTarget(node.right), owned)) return null;
  const left = node.left;
  if (!isNodeOfType(left, "VariableDeclaration")) return null;
  const declarator = left.declarations[0];
  if (!declarator || !isNodeOfType(declarator.id, "Identifier")) return null;
  return declarator.id;
};

const CLEANUP_EFFECT_HOOKS = new Set(["useEffect", "useLayoutEffect", "useInsertionEffect"]);

const enclosingFunctionOf = (node: EsTreeNode): EsTreeNode | null => {
  let cursor: EsTreeNode | null | undefined = node.parent;
  while (cursor) {
    if (
      isNodeOfType(cursor, "FunctionDeclaration") ||
      isNodeOfType(cursor, "FunctionExpression") ||
      isNodeOfType(cursor, "ArrowFunctionExpression")
    ) {
      return cursor;
    }
    cursor = cursor.parent ?? null;
  }
  return null;
};

// A mutation inside an effect CLEANUP restores/clears state on teardown —
// that is the rule's remediation, not the hazard.
const isInsideEffectCleanup = (node: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null = enclosingFunctionOf(node);
  while (cursor) {
    const maybeReturn = cursor.parent;
    if (maybeReturn && isNodeOfType(maybeReturn, "ReturnStatement")) {
      const effectCallback = enclosingFunctionOf(maybeReturn);
      const effectCall = effectCallback?.parent;
      if (
        effectCallback &&
        effectCall &&
        isNodeOfType(effectCall, "CallExpression") &&
        isNodeOfType(effectCall.callee, "Identifier") &&
        CLEANUP_EFFECT_HOOKS.has(effectCall.callee.name) &&
        effectCall.arguments?.[0] === effectCallback
      ) {
        return true;
      }
    }
    cursor = enclosingFunctionOf(cursor);
  }
  return false;
};

const OPPOSITE_CLASS_METHOD: Record<string, string> = { add: "remove", remove: "add" };

const receiverIdentifierName = (receiver: EsTreeNode): string | null => {
  const stripped = stripParenExpression(receiver);
  return isNodeOfType(stripped, "Identifier") ? stripped.name : null;
};

// `sheet.classList.add('print-expanded'); window.print();
// sheet.classList.remove('print-expanded')` — a balanced add/remove of the
// SAME class in the same function (or an effect + its cleanup) is a
// temporary toggle React never observes mid-render.
const hasBalancedClassToggle = (mutationCall: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = mutationCall.callee;
  if (!isNodeOfType(callee, "MemberExpression") || !isNodeOfType(callee.property, "Identifier")) {
    return false;
  }
  const methodName = callee.property.name;
  const oppositeMethod = OPPOSITE_CLASS_METHOD[methodName];
  if (!oppositeMethod) return false;
  const receiver = classListMutationReceiver(callee);
  const receiverName = receiver ? receiverIdentifierName(receiver) : null;
  if (!receiverName) return false;
  const classArgument = mutationCall.arguments?.[0];
  if (
    !classArgument ||
    !isNodeOfType(classArgument, "Literal") ||
    typeof classArgument.value !== "string"
  ) {
    return false;
  }
  const className = classArgument.value;
  const scope = enclosingFunctionOf(mutationCall);
  if (!scope) return false;
  let balanced = false;
  walkAst(scope, (child: EsTreeNode) => {
    if (balanced) return false;
    if (child === mutationCall || !isNodeOfType(child, "CallExpression")) return;
    const childCallee = child.callee;
    if (
      !isNodeOfType(childCallee, "MemberExpression") ||
      !isNodeOfType(childCallee.property, "Identifier") ||
      childCallee.property.name !== oppositeMethod
    ) {
      return;
    }
    const childReceiver = classListMutationReceiver(childCallee);
    if (!childReceiver || receiverIdentifierName(childReceiver) !== receiverName) return;
    const childArgument = child.arguments?.[0];
    if (
      childArgument &&
      isNodeOfType(childArgument, "Literal") &&
      childArgument.value === className
    ) {
      balanced = true;
      return false;
    }
  });
  return balanced;
};

// `const prev = node.style.boxShadow; node.style.boxShadow = 'none';
// ... node.style.boxShadow = prev` — the property is saved before and
// restored after (try/finally export snapshots, auto-fit measurement).
const hasStyleSaveRestore = (assignment: EsTreeNodeOfType<"AssignmentExpression">): boolean => {
  const target = assignment.left;
  if (
    !isNodeOfType(target, "MemberExpression") ||
    target.computed ||
    !isNodeOfType(target.property, "Identifier")
  ) {
    return false;
  }
  const propertyName = target.property.name;
  const receiver = styleAssignmentReceiver(target);
  const receiverName = receiver ? receiverIdentifierName(receiver) : null;
  if (!receiverName) return false;
  const scope = enclosingFunctionOf(assignment);
  if (!scope) return false;
  const matchesStyleRead = (candidate: EsTreeNode): boolean => {
    if (!isNodeOfType(candidate, "MemberExpression") || candidate.computed) return false;
    if (!isNodeOfType(candidate.property, "Identifier")) return false;
    if (candidate.property.name !== propertyName) return false;
    const readReceiver = styleAssignmentReceiver(candidate);
    return (
      Boolean(readReceiver) && receiverIdentifierName(readReceiver as EsTreeNode) === receiverName
    );
  };
  const savedNames = new Set<string>();
  walkAst(scope, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.init &&
      matchesStyleRead(stripParenExpression(child.init as EsTreeNode))
    ) {
      savedNames.add(child.id.name);
    }
  });
  if (savedNames.size === 0) return false;
  // The restore assignment itself (`node.style.x = previousX`) is exempt
  // directly — its right-hand side IS the saved value.
  const ownValue = stripParenExpression(assignment.right as EsTreeNode);
  if (isNodeOfType(ownValue, "Identifier") && savedNames.has(ownValue.name)) return true;
  let restored = false;
  walkAst(scope, (child: EsTreeNode) => {
    if (restored) return false;
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child !== assignment &&
      matchesStyleRead(child.left as EsTreeNode)
    ) {
      const value = stripParenExpression(child.right as EsTreeNode);
      if (isNodeOfType(value, "Identifier") && savedNames.has(value.name)) {
        restored = true;
        return false;
      }
    }
  });
  return restored;
};

export const noMutateQueriedDomNodeInComponent = defineRule({
  id: "no-mutate-queried-dom-node-in-component",
  title: "Mutating a queried DOM node this component renders",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Drive the node with state/props (or a ref for genuinely uncontrolled nodes) instead of querying it and mutating its style/class. Imperative edits to a node React renders are invisible to the virtual DOM and get reverted or clobbered on the next render.",
  create: (context: RuleContext) => {
    let ownedTokens: OwnedTokens | null = null;
    const reported = new WeakSet<EsTreeNode>();

    const receiverIsOwnedQuery = (
      receiver: EsTreeNode,
      ownedQueryVariables: Set<string>,
      owned: OwnedTokens,
    ): boolean => {
      const stripped = stripParenExpression(receiver);
      if (isNodeOfType(stripped, "Identifier")) return ownedQueryVariables.has(stripped.name);
      if (isNodeOfType(stripped, "CallExpression")) {
        return isOwnedQueryTarget(queryCallTarget(stripped), owned);
      }
      return false;
    };

    const reportMutation = (node: EsTreeNode, mutatedSurface: "style" | "classList"): void => {
      if (reported.has(node)) return;
      reported.add(node);
      context.report({
        node,
        message: `You mutate the ${mutatedSurface} of a DOM node this component renders, so React reverts your change on the next render; drive it with state/props or a ref instead.`,
      });
    };

    const analyzeComponent = (functionNode: EsTreeNode, owned: OwnedTokens): void => {
      const ownedBindingIdentifiers = new Set<EsTreeNode>();
      const ownedQueryVariables = new Set<string>();
      walkAst(functionNode, (node: EsTreeNode) => {
        if (
          isNodeOfType(node, "VariableDeclarator") &&
          isNodeOfType(node.id, "Identifier") &&
          node.init &&
          isOwnedQueryTarget(queryCallTarget(node.init), owned)
        ) {
          ownedBindingIdentifiers.add(node.id);
          ownedQueryVariables.add(node.id.name);
          return;
        }
        const iterationBinding =
          ownedNodeListCallbackParam(node, owned) ?? ownedNodeListLoopBinding(node, owned);
        if (iterationBinding) {
          ownedBindingIdentifiers.add(iterationBinding);
          ownedQueryVariables.add(iterationBinding.name);
        }
      });

      // A same-named binding elsewhere in the component (shadowing const,
      // callback parameter, catch param) means the bare name no longer proves
      // the receiver is the queried node, so drop the name entirely.
      const dropShadowedName = (identifier: EsTreeNodeOfType<"Identifier">): void => {
        if (!ownedBindingIdentifiers.has(identifier)) {
          ownedQueryVariables.delete(identifier.name);
        }
      };
      walkAst(functionNode, (node: EsTreeNode) => {
        if (isNodeOfType(node, "VariableDeclarator")) {
          collectPatternIdentifiers(node.id, dropShadowedName);
          return;
        }
        if (
          isNodeOfType(node, "FunctionDeclaration") ||
          isNodeOfType(node, "FunctionExpression") ||
          isNodeOfType(node, "ArrowFunctionExpression")
        ) {
          for (const parameter of node.params) {
            collectPatternIdentifiers(parameter, dropShadowedName);
          }
          return;
        }
        if (isNodeOfType(node, "CatchClause")) {
          collectPatternIdentifiers(node.param, dropShadowedName);
        }
      });

      walkAst(functionNode, (node: EsTreeNode) => {
        if (isNodeOfType(node, "AssignmentExpression")) {
          const receiver = styleAssignmentReceiver(node.left);
          if (receiver && receiverIsOwnedQuery(receiver, ownedQueryVariables, owned)) {
            if (isInsideEffectCleanup(node) || hasStyleSaveRestore(node)) return;
            reportMutation(node, "style");
          }
          return;
        }
        if (isNodeOfType(node, "CallExpression")) {
          const classListReceiver = classListMutationReceiver(node.callee);
          if (
            classListReceiver &&
            receiverIsOwnedQuery(classListReceiver, ownedQueryVariables, owned)
          ) {
            if (isInsideEffectCleanup(node) || hasBalancedClassToggle(node)) return;
            reportMutation(node, "classList");
            return;
          }
          const styleReceiver = stylePropertyCallReceiver(node.callee);
          if (styleReceiver && receiverIsOwnedQuery(styleReceiver, ownedQueryVariables, owned)) {
            if (isInsideEffectCleanup(node)) return;
            reportMutation(node, "style");
          }
        }
      });
    };

    const visitFunction = (functionNode: EsTreeNode): void => {
      if (!ownedTokens) return;
      if (!componentOrHookDisplayNameForFunction(functionNode)) return;
      analyzeComponent(functionNode, ownedTokens);
    };

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        ownedTokens = collectOwnedTokens(node);
      },
      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        visitFunction(node);
      },
      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        visitFunction(node);
      },
      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        visitFunction(node);
      },
    };
  },
});
