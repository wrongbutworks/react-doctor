import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isFunctionLike = (
  node: EsTreeNode | null | undefined,
): node is
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression"> => {
  if (!node) return false;
  return (
    isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression")
  );
};

// Given a parsed Program AST and an exported name, returns the
// function/arrow node bound to that export, or null if the export
// doesn't resolve to a function in this file. Handles:
//
//   export function reducer(state, action) {...}
//   export const reducer = (state, action) => {...}
//   export const reducer = function (state, action) {...}
//   export default function reducer(state, action) {...}
//   export default function (state, action) {...}              (exportedName === "default")
//   export default (state, action) => {...}                    (exportedName === "default")
//   function reducer(state, action) {...}; export { reducer };
//   const reducer = (...) => {...}; export { reducer };
//   export { reducer as default };                              (exportedName === "default")
//
// Re-exports (`export { reducer } from "./other"`,
// `export * from "./other"`) are NOT followed here — that's the
// barrel-following layer's job (see `resolve-barrel-export-file-path`).
// If a re-export is encountered the function returns null and the
// caller is expected to resolve the barrel separately.
export const findExportedFunctionBody = (
  programRoot: EsTreeNode,
  exportedName: string,
): EsTreeNode | null => {
  if (!isNodeOfType(programRoot, "Program")) return null;

  const localBindings = new Map<string, EsTreeNode>();
  const namedExports = new Map<string, string>();
  let defaultExport: EsTreeNode | null = null;
  // `export default someIdentifier` — resolved after all local bindings
  // are gathered (the identifier may be declared later in the file).
  let defaultExportIdentifierName: string | null = null;

  const recordVariableDeclaration = (declaration: EsTreeNodeOfType<"VariableDeclaration">) => {
    for (const declarator of declaration.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      const initializer = declarator.init ? stripParenExpression(declarator.init) : null;
      if (initializer && isFunctionLike(initializer)) {
        localBindings.set(declarator.id.name, initializer);
      }
    }
  };

  for (const statement of programRoot.body ?? []) {
    if (isNodeOfType(statement, "VariableDeclaration")) {
      recordVariableDeclaration(statement);
      continue;
    }
    if (isNodeOfType(statement, "FunctionDeclaration") && statement.id) {
      localBindings.set(statement.id.name, statement);
      continue;
    }

    if (isNodeOfType(statement, "ExportNamedDeclaration")) {
      const declaration = statement.declaration;
      if (declaration && isNodeOfType(declaration, "VariableDeclaration")) {
        recordVariableDeclaration(declaration);
        for (const declarator of declaration.declarations ?? []) {
          if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
          if (!isNodeOfType(declarator.id, "Identifier")) continue;
          namedExports.set(declarator.id.name, declarator.id.name);
        }
      } else if (
        declaration &&
        isNodeOfType(declaration, "FunctionDeclaration") &&
        declaration.id
      ) {
        localBindings.set(declaration.id.name, declaration);
        namedExports.set(declaration.id.name, declaration.id.name);
      }
      // A re-export specifier (`export { x } from "./x"`) binds no local
      // declaration — mapping it here would let a same-named local decoy
      // shadow the re-export and resolve to the wrong function.
      if (statement.source) continue;
      for (const specifier of statement.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
        const local = specifier.local;
        const exported = specifier.exported;
        if (!isNodeOfType(local, "Identifier")) continue;
        const exportedNameSpec = isNodeOfType(exported, "Identifier")
          ? exported.name
          : isNodeOfType(exported, "Literal") && typeof exported.value === "string"
            ? exported.value
            : null;
        if (!exportedNameSpec) continue;
        namedExports.set(exportedNameSpec, local.name);
      }
      continue;
    }

    if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
      const declaration = statement.declaration;
      if (!declaration) continue;
      if (isNodeOfType(declaration, "FunctionDeclaration") && declaration.id) {
        localBindings.set(declaration.id.name, declaration);
        defaultExport = declaration;
        continue;
      }
      if (isFunctionLike(declaration)) {
        defaultExport = declaration;
        continue;
      }
      if (isNodeOfType(declaration, "Identifier")) {
        // Resolved lazily below — we need to wait until all local
        // bindings are gathered.
        defaultExportIdentifierName = declaration.name;
        continue;
      }
    }
  }

  if (exportedName === "default") {
    if (defaultExport) return defaultExport;
    if (defaultExportIdentifierName) {
      const binding = localBindings.get(defaultExportIdentifierName);
      if (binding) return binding;
    }
    // `export { reducer as default }` — the specifier loop above
    // recorded `namedExports.set("default", "reducer")`. Fall
    // through to the general lookup so the rename-as-default shape
    // resolves correctly.
  }

  const localName = namedExports.get(exportedName);
  if (!localName) return null;
  return localBindings.get(localName) ?? null;
};

// Given a parsed Program AST and an exported name, returns the initializer
// EXPRESSION bound to that export, or null when the export doesn't resolve
// to a variable initializer in this file. Handles:
//
//   export const config = <expr>
//   const config = <expr>; export { config };
//   const config = <expr>; export { config as settings };   (exportedName === "settings")
//   const config = <expr>; export { config as default };    (exportedName === "default")
//
// Function/arrow initializers are returned too — callers that distinguish
// functions from plain initializers should try `findExportedFunctionBody`
// first. Re-exports are NOT followed here (see `findReExportTargetsForName`).
export const findExportedConstInitializer = (
  programRoot: EsTreeNode,
  exportedName: string,
): EsTreeNode | null => {
  if (!isNodeOfType(programRoot, "Program")) return null;

  const initializersByLocalName = new Map<string, EsTreeNode>();
  const localNamesByExportedName = new Map<string, string>();

  const recordVariableDeclaration = (declaration: EsTreeNodeOfType<"VariableDeclaration">) => {
    for (const declarator of declaration.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      if (!declarator.init) continue;
      initializersByLocalName.set(declarator.id.name, stripParenExpression(declarator.init));
    }
  };

  for (const statement of programRoot.body ?? []) {
    if (isNodeOfType(statement, "VariableDeclaration")) {
      recordVariableDeclaration(statement);
      continue;
    }
    if (!isNodeOfType(statement, "ExportNamedDeclaration")) continue;

    const declaration = statement.declaration;
    if (declaration && isNodeOfType(declaration, "VariableDeclaration")) {
      recordVariableDeclaration(declaration);
      for (const declarator of declaration.declarations ?? []) {
        if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
        if (!isNodeOfType(declarator.id, "Identifier")) continue;
        localNamesByExportedName.set(declarator.id.name, declarator.id.name);
      }
    }
    // A re-export specifier (`export { x } from "./x"`) binds no local
    // initializer, so specifiers with a source are skipped.
    if (statement.source) continue;
    for (const specifier of statement.specifiers ?? []) {
      if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
      if (!isNodeOfType(specifier.local, "Identifier")) continue;
      const exportedNameSpec = isNodeOfType(specifier.exported, "Identifier")
        ? specifier.exported.name
        : isNodeOfType(specifier.exported, "Literal") &&
            typeof specifier.exported.value === "string"
          ? specifier.exported.value
          : null;
      if (exportedNameSpec) localNamesByExportedName.set(exportedNameSpec, specifier.local.name);
    }
  }

  const localName = localNamesByExportedName.get(exportedName);
  if (!localName) return null;
  return initializersByLocalName.get(localName) ?? null;
};

// Convenience: returns the source-side identifier name for an
// import specifier. Handles both `import { foo } from "..."` and
// `import { foo as localBar } from "..."` — returning "foo" in both
// cases. For default imports returns "default". For namespace
// imports returns null (caller should treat as opaque).
export const resolveImportedExportName = (importSpecifier: EsTreeNode): string | null => {
  if (isNodeOfType(importSpecifier, "ImportSpecifier")) {
    const imported = importSpecifier.imported;
    if (isNodeOfType(imported, "Identifier")) return imported.name;
    if (isNodeOfType(imported, "Literal") && typeof imported.value === "string") {
      return imported.value;
    }
    return null;
  }
  if (isNodeOfType(importSpecifier, "ImportDefaultSpecifier")) {
    return "default";
  }
  // ImportNamespaceSpecifier: the entire module's namespace. Cannot
  // map to a single exported name here.
  return null;
};

export interface ReExportTarget {
  readonly source: string;
  /** The name to look up in `source` — the pre-rename local of a named re-export. */
  readonly importedName: string;
}

// Returns the re-export targets the caller should probe to resolve
// `exportedName`, in priority order:
//
//   - A matching named re-export (`export { name } from "./x"`, including
//     renames — `export { inner as name } from "./x"` maps back to
//     `inner`) is precise, so the single matching target is returned on
//     its own.
//   - Otherwise the name may live behind ANY `export * from "./x"`, so
//     every export-all source is returned for the caller to try in
//     turn (an earlier `export *` not containing the name shouldn't
//     stop the search).
//
// Empty when no re-export could carry the name.
export const findReExportTargetsForName = (
  programRoot: EsTreeNode,
  exportedName: string,
): ReExportTarget[] => {
  if (!isNodeOfType(programRoot, "Program")) return [];
  const exportAllTargets: ReExportTarget[] = [];
  for (const statement of programRoot.body ?? []) {
    if (isNodeOfType(statement, "ExportNamedDeclaration") && statement.source) {
      const sourceValue = statement.source.value;
      if (typeof sourceValue !== "string") continue;
      for (const specifier of statement.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
        const exported = specifier.exported;
        const exportedNameSpec = isNodeOfType(exported, "Identifier")
          ? exported.name
          : isNodeOfType(exported, "Literal") && typeof exported.value === "string"
            ? exported.value
            : null;
        if (exportedNameSpec !== exportedName) continue;
        const importedName = isNodeOfType(specifier.local, "Identifier")
          ? specifier.local.name
          : isNodeOfType(specifier.local, "Literal") && typeof specifier.local.value === "string"
            ? specifier.local.value
            : exportedName;
        return [{ source: sourceValue, importedName }];
      }
    }
    // `export * as ns from "./x"` re-exports only the namespace object, not
    // the module's individual names — following it would resolve names the
    // barrel never exposes.
    if (
      isNodeOfType(statement, "ExportAllDeclaration") &&
      statement.source &&
      statement.exported == null
    ) {
      const sourceValue = statement.source.value;
      if (typeof sourceValue === "string") {
        exportAllTargets.push({ source: sourceValue, importedName: exportedName });
      }
    }
  }
  return exportAllTargets;
};

// Source-only view of `findReExportTargetsForName` for callers that recurse
// with the same exported name (rename-blind, matching the barrel resolver's
// historical behavior).
export const findReExportSourcesForName = (
  programRoot: EsTreeNode,
  exportedName: string,
): string[] =>
  findReExportTargetsForName(programRoot, exportedName).map(
    (reExportTarget) => reExportTarget.source,
  );
