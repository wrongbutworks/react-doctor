import { defineRule } from "../../utils/define-rule.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { isEarlyExitStatement } from "../../utils/is-early-exit-statement.js";
import { isInsideTryStatement } from "../../utils/is-inside-try-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Identifier names that resolve the RegExp source to a user/config search,
// filter, highlight, or query term (the values that carry unescaped regex
// metacharacters). Kept deliberately narrow so controlled/constant sources
// stay quiet. `term(?!in)` keeps `searchTerm` while excluding
// `terminalSequence` / `terminate`-shaped names.
const SEARCH_TERM_NAME_PATTERN = /search|query|highlight|filter|term(?!in)|keyword/i;

// An escape helper applied to the value makes the pattern safe. Also treat
// `.replace(...)` / `.replaceAll(...)` as author-driven sanitization.
const ESCAPE_HELPER_NAME_PATTERN = /escape.*reg|safe.*reg/i;

// A binding named like `escapedSearchString` is an explicit author claim
// that the value was sanitized before construction.
const SANITIZED_NAME_PATTERN = /escap|sanitiz/i;

// How many identifier-to-initializer hops to follow when checking whether
// a binding was escaped on a prior line (`const escaped = escapeRegExp(q);
// const pattern = escaped; new RegExp(pattern)`).
const INITIALIZER_RESOLUTION_HOPS = 2;

const isRegExpConstruction = (node: EsTreeNode): boolean => {
  const callee = isNodeOfType(node, "CallExpression")
    ? node.callee
    : isNodeOfType(node, "NewExpression")
      ? node.callee
      : null;
  return Boolean(callee && isNodeOfType(callee, "Identifier") && callee.name === "RegExp");
};

const isFullyLiteralPattern = (argument: EsTreeNode): boolean => {
  const stripped = stripParenExpression(argument);
  if (isNodeOfType(stripped, "Literal")) return true;
  if (isNodeOfType(stripped, "TemplateLiteral") && (stripped.expressions?.length ?? 0) === 0) {
    return true;
  }
  return false;
};

const isRegExpEscapeBuiltin = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "MemberExpression") &&
  isNodeOfType(callee.object, "Identifier") &&
  callee.object.name === "RegExp" &&
  isNodeOfType(callee.property, "Identifier") &&
  callee.property.name === "escape";

const containsEscapingCall = (root: EsTreeNode): boolean => {
  let found = false;
  walkAst(root, (child: EsTreeNode) => {
    if (found) return false;
    if (isEscapingCall(child)) {
      found = true;
      return false;
    }
  });
  return found;
};

// `terms.map(escapeRegExp)` / `terms.map((t) => escapeRegExp(t))` /
// `terms.map((t) => t.replace(...))` — the rule's escape-first remediation
// applied element-wise before a `.join` alternation.
const isElementWiseEscapingMap = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  if (
    !isNodeOfType(node.callee, "MemberExpression") ||
    node.callee.computed ||
    !isNodeOfType(node.callee.property, "Identifier") ||
    node.callee.property.name !== "map"
  ) {
    return false;
  }
  const mapper = node.arguments?.[0] ? stripParenExpression(node.arguments[0] as EsTreeNode) : null;
  if (!mapper) return false;
  if (isNodeOfType(mapper, "Identifier")) return ESCAPE_HELPER_NAME_PATTERN.test(mapper.name);
  if (isNodeOfType(mapper, "MemberExpression")) return isRegExpEscapeBuiltin(mapper);
  if (
    isNodeOfType(mapper, "ArrowFunctionExpression") ||
    isNodeOfType(mapper, "FunctionExpression")
  ) {
    return containsEscapingCall(mapper.body as EsTreeNode);
  }
  return false;
};

// A same-file helper whose body performs the escape (`const
// escapeSpecialChars = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`)
// sanitizes regardless of whether its name matches the helper pattern.
const calleeBindingBodyEscapes = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(node.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const binding = findVariableInitializer(callee, callee.name);
  return Boolean(binding?.initializer && containsEscapingCall(binding.initializer));
};

const isEscapingCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (isRegExpEscapeBuiltin(node.callee)) return true;
  const calleeName = getCalleeName(node);
  if (
    calleeName &&
    (ESCAPE_HELPER_NAME_PATTERN.test(calleeName) ||
      calleeName === "replace" ||
      calleeName === "replaceAll")
  ) {
    return true;
  }
  return isElementWiseEscapingMap(node) || calleeBindingBodyEscapes(node);
};

const isRegexSourceAccess = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "source";

// Method/property name positions (`terms.filter(...)`, `{ query: x }`) are
// not value reads — only value-position identifiers can carry the term.
const isPropertyNamePosition = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  if (!parent) return false;
  if (isNodeOfType(parent, "MemberExpression")) {
    return parent.property === identifier && !parent.computed;
  }
  return isNodeOfType(parent, "Property") && parent.key === identifier && !parent.computed;
};

const collectRawSearchTermIdentifiers = (
  argument: EsTreeNode,
): EsTreeNodeOfType<"Identifier">[] => {
  const rawSearchTermIdentifiers: EsTreeNodeOfType<"Identifier">[] = [];
  walkAst(argument, (child: EsTreeNode) => {
    if (isEscapingCall(child) || isRegexSourceAccess(child)) return false;
    if (
      isNodeOfType(child, "Identifier") &&
      SEARCH_TERM_NAME_PATTERN.test(child.name) &&
      !isPropertyNamePosition(child)
    ) {
      rawSearchTermIdentifiers.push(child);
    }
  });
  return rawSearchTermIdentifiers;
};

const collectLeafIdentifiers = (node: EsTreeNode): EsTreeNodeOfType<"Identifier">[] => {
  const leafIdentifiers: EsTreeNodeOfType<"Identifier">[] = [];
  walkAst(node, (child: EsTreeNode) => {
    if (isEscapingCall(child) || isRegexSourceAccess(child)) return false;
    if (isNodeOfType(child, "Identifier") && !isPropertyNamePosition(child)) {
      leafIdentifiers.push(child);
    }
  });
  return leafIdentifiers;
};

const compositeInitializerResolvesEscaped = (
  strippedInitializer: EsTreeNode,
  remainingHops: number,
): boolean => {
  let didResolveAnyLeafEscaped = false;
  for (const leafIdentifier of collectLeafIdentifiers(strippedInitializer)) {
    if (identifierResolvesToEscapedValue(leafIdentifier, remainingHops)) {
      didResolveAnyLeafEscaped = true;
    } else if (SEARCH_TERM_NAME_PATTERN.test(leafIdentifier.name)) {
      return false;
    }
  }
  return didResolveAnyLeafEscaped;
};

const initializerLooksEscaped = (initializer: EsTreeNode, remainingHops: number): boolean => {
  const strippedInitializer = stripParenExpression(initializer);
  if (isFullyLiteralPattern(strippedInitializer)) return true;
  // A regex literal binding (`const re = /x/;` re-passed to `new RegExp`)
  // and a fully-literal keyword table (`["SELECT", "FROM"].join("|")`)
  // carry only developer-authored characters.
  if (isNodeOfType(strippedInitializer, "Literal") && "regex" in strippedInitializer) return true;
  if (
    isNodeOfType(strippedInitializer, "ArrayExpression") &&
    (strippedInitializer.elements ?? []).every(
      (element) => element && isFullyLiteralPattern(element as EsTreeNode),
    )
  ) {
    return true;
  }
  if (containsEscapingCall(strippedInitializer)) return true;
  if (remainingHops > 0) {
    if (isNodeOfType(strippedInitializer, "Identifier")) {
      return identifierResolvesToEscapedValue(strippedInitializer, remainingHops - 1);
    }
    return compositeInitializerResolvesEscaped(strippedInitializer, remainingHops - 1);
  }
  return false;
};

const REGEXP_OBJECT_PROPERTY_NAMES = new Set(["flags", "global", "source", "sticky", "lastIndex"]);
const SCREAMING_SNAKE_CONSTANT_PATTERN = /^[A-Z][A-Z0-9_]*$/;

// The identifier is a RegExp OBJECT, not a string: somewhere in the file
// the same name is read with a regex-only property (`searchPattern.flags`,
// `searchPattern.global`). `new RegExp(existingRegex, flags)` copies
// `.source` verbatim — escaping is meaningless there.
const isRegExpObjectIdentifier = (identifier: EsTreeNodeOfType<"Identifier">): boolean => {
  let root: EsTreeNode = identifier;
  while (root.parent) root = root.parent;
  let proven = false;
  walkAst(root, (child: EsTreeNode) => {
    if (proven) return false;
    if (
      isNodeOfType(child, "MemberExpression") &&
      !child.computed &&
      isNodeOfType(child.object, "Identifier") &&
      child.object.name === identifier.name &&
      isNodeOfType(child.property, "Identifier") &&
      REGEXP_OBJECT_PROPERTY_NAMES.has(child.property.name)
    ) {
      proven = true;
      return false;
    }
  });
  return proven;
};

const identifierResolvesToEscapedValue = (
  identifier: EsTreeNodeOfType<"Identifier">,
  remainingHops: number,
): boolean => {
  if (SANITIZED_NAME_PATTERN.test(identifier.name)) return true;
  // SCREAMING_SNAKE names are developer-authored pattern constants (often
  // imported, so their initializer is unresolvable) — the metacharacters
  // ARE the pattern.
  if (SCREAMING_SNAKE_CONSTANT_PATTERN.test(identifier.name)) return true;
  if (isRegExpObjectIdentifier(identifier)) return true;
  const binding = findVariableInitializer(identifier, identifier.name);
  if (!binding?.initializer) return false;
  return initializerLooksEscaped(binding.initializer, remainingHops);
};

// A dominating guard already shape-tested the term (`if
// (!/^[\w\s]*$/.test(query)) return value.includes(query);`) — the
// construction only runs on metacharacter-free values.
const isShapeTestedByDominatingGuard = (
  constructionNode: EsTreeNode,
  identifierName: string,
): boolean => {
  const guardContainsShapeTest = (guardTest: EsTreeNode): boolean => {
    let found = false;
    walkAst(guardTest, (child: EsTreeNode) => {
      if (found) return false;
      if (
        isNodeOfType(child, "CallExpression") &&
        isNodeOfType(child.callee, "MemberExpression") &&
        !child.callee.computed &&
        isNodeOfType(child.callee.property, "Identifier") &&
        child.callee.property.name === "test" &&
        (child.arguments ?? []).some(
          (argument) =>
            isNodeOfType(argument as EsTreeNode, "Identifier") &&
            (argument as EsTreeNodeOfType<"Identifier">).name === identifierName,
        )
      ) {
        found = true;
        return false;
      }
    });
    return found;
  };
  let child: EsTreeNode = constructionNode;
  let ancestor: EsTreeNode | null | undefined = constructionNode.parent;
  while (ancestor) {
    if (
      (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) &&
      ancestor.test !== child &&
      guardContainsShapeTest(ancestor.test)
    ) {
      return true;
    }
    if (isNodeOfType(ancestor, "BlockStatement") || isNodeOfType(ancestor, "Program")) {
      const statements = ancestor.body;
      const childStatementIndex = statements.findIndex((statement) => statement === child);
      for (const precedingStatement of statements.slice(0, Math.max(childStatementIndex, 0))) {
        if (
          isNodeOfType(precedingStatement, "IfStatement") &&
          isEarlyExitStatement(precedingStatement.consequent) &&
          guardContainsShapeTest(precedingStatement.test)
        ) {
          return true;
        }
      }
    }
    child = ancestor;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

export const noUnescapedDynamicStringInRegexp = defineRule({
  id: "no-unescaped-dynamic-string-in-regexp",
  title: "Unescaped dynamic string in RegExp constructor",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "A search/filter/highlight term dropped straight into `new RegExp(...)` lets its regex metacharacters act as operators, so a user typing `.` or `(` over-matches or throws. Escape the value with an `escapeRegExp` helper before constructing the pattern.",
  create: (context: RuleContext) => {
    const reportUnescapedConstruction = (
      node: EsTreeNodeOfType<"CallExpression"> | EsTreeNodeOfType<"NewExpression">,
    ): void => {
      if (!isRegExpConstruction(node)) return;
      const firstArgument = node.arguments?.[0];
      if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return;
      if (isFullyLiteralPattern(firstArgument)) return;
      const rawSearchTermIdentifiers = collectRawSearchTermIdentifiers(firstArgument);
      const hasUnescapedSearchTerm = rawSearchTermIdentifiers.some(
        (identifier) =>
          !identifierResolvesToEscapedValue(identifier, INITIALIZER_RESOLUTION_HOPS) &&
          !isShapeTestedByDominatingGuard(node, identifier.name),
      );
      if (!hasUnescapedSearchTerm) return;
      if (isInsideTryStatement(node, { region: "block" })) return;
      context.report({
        node,
        message:
          "This builds a `RegExp` from a dynamic search/filter term without escaping it, so regex metacharacters in the value act as operators and over-match or throw. Escape the value with an `escapeRegExp` helper first.",
      });
    };
    return {
      NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
        reportUnescapedConstruction(node);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        reportUnescapedConstruction(node);
      },
    };
  },
});
