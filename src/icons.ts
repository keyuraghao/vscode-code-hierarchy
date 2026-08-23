import * as vscode from 'vscode';

/**
 * VS Code ships a `symbol-*` codicon for every SymbolKind, and themes colour
 * them through the `symbolIcon.*Foreground` tokens, so using them keeps the
 * tree consistent with Outline, breadcrumbs and IntelliSense.
 */
const CODICON_BY_KIND: Record<number, string> = {
    [vscode.SymbolKind.File]: 'symbol-file',
    [vscode.SymbolKind.Module]: 'symbol-module',
    [vscode.SymbolKind.Namespace]: 'symbol-namespace',
    [vscode.SymbolKind.Package]: 'symbol-package',
    [vscode.SymbolKind.Class]: 'symbol-class',
    [vscode.SymbolKind.Method]: 'symbol-method',
    [vscode.SymbolKind.Property]: 'symbol-property',
    [vscode.SymbolKind.Field]: 'symbol-field',
    [vscode.SymbolKind.Constructor]: 'symbol-constructor',
    [vscode.SymbolKind.Enum]: 'symbol-enum',
    [vscode.SymbolKind.Interface]: 'symbol-interface',
    [vscode.SymbolKind.Function]: 'symbol-function',
    [vscode.SymbolKind.Variable]: 'symbol-variable',
    [vscode.SymbolKind.Constant]: 'symbol-constant',
    [vscode.SymbolKind.String]: 'symbol-string',
    [vscode.SymbolKind.Number]: 'symbol-number',
    [vscode.SymbolKind.Boolean]: 'symbol-boolean',
    [vscode.SymbolKind.Array]: 'symbol-array',
    [vscode.SymbolKind.Object]: 'symbol-object',
    [vscode.SymbolKind.Key]: 'symbol-key',
    [vscode.SymbolKind.Null]: 'symbol-null',
    [vscode.SymbolKind.EnumMember]: 'symbol-enum-member',
    [vscode.SymbolKind.Struct]: 'symbol-struct',
    [vscode.SymbolKind.Event]: 'symbol-event',
    [vscode.SymbolKind.Operator]: 'symbol-operator',
    [vscode.SymbolKind.TypeParameter]: 'symbol-type-parameter'
};

const LABEL_BY_KIND: Record<number, string> = {
    [vscode.SymbolKind.File]: 'file',
    [vscode.SymbolKind.Module]: 'module',
    [vscode.SymbolKind.Namespace]: 'namespace',
    [vscode.SymbolKind.Package]: 'package',
    [vscode.SymbolKind.Class]: 'class',
    [vscode.SymbolKind.Method]: 'method',
    [vscode.SymbolKind.Property]: 'property',
    [vscode.SymbolKind.Field]: 'field',
    [vscode.SymbolKind.Constructor]: 'constructor',
    [vscode.SymbolKind.Enum]: 'enum',
    [vscode.SymbolKind.Interface]: 'interface',
    [vscode.SymbolKind.Function]: 'function',
    [vscode.SymbolKind.Variable]: 'variable',
    [vscode.SymbolKind.Constant]: 'constant',
    [vscode.SymbolKind.String]: 'string',
    [vscode.SymbolKind.Number]: 'number',
    [vscode.SymbolKind.Boolean]: 'boolean',
    [vscode.SymbolKind.Array]: 'array',
    [vscode.SymbolKind.Object]: 'object',
    [vscode.SymbolKind.Key]: 'key',
    [vscode.SymbolKind.Null]: 'null',
    [vscode.SymbolKind.EnumMember]: 'enum member',
    [vscode.SymbolKind.Struct]: 'struct',
    [vscode.SymbolKind.Event]: 'event',
    [vscode.SymbolKind.Operator]: 'operator',
    [vscode.SymbolKind.TypeParameter]: 'type parameter'
};

export function iconForKind(kind: vscode.SymbolKind): vscode.ThemeIcon {
    return new vscode.ThemeIcon(CODICON_BY_KIND[kind] ?? 'symbol-misc');
}

export function labelForKind(kind: vscode.SymbolKind): string {
    return LABEL_BY_KIND[kind] ?? 'symbol';
}
