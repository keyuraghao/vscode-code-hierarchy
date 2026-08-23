import * as vscode from 'vscode';

/**
 * One node of the hierarchy shown in the tree. This is deliberately our own
 * shape rather than `vscode.DocumentSymbol`: we need stable ids for the tree,
 * a parent pointer for `TreeView.reveal`, and a flag recording whether the
 * node came from a real language server or from the fallback parser.
 */
export interface SymbolNode {
    /** Stable across refreshes of an unchanged file, so expansion state sticks. */
    id: string;
    name: string;
    detail: string;
    kind: vscode.SymbolKind;
    /** Full extent of the symbol, used for "which symbol is the cursor in?". */
    range: vscode.Range;
    /** Just the name, used as the jump target. */
    selectionRange: vscode.Range;
    children: SymbolNode[];
    parent?: SymbolNode;
    /** True when produced by the regex fallback rather than a language server. */
    approximate: boolean;
    /** Depth from the root, 0-based. */
    depth: number;
}

export interface Hierarchy {
    uri: vscode.Uri;
    languageId: string;
    version: number;
    roots: SymbolNode[];
    approximate: boolean;
    /** Total node count, including nested ones. */
    count: number;
}

export const EMPTY_HIERARCHY: Hierarchy = {
    uri: vscode.Uri.parse('untitled:none'),
    languageId: '',
    version: -1,
    roots: [],
    approximate: false,
    count: 0
};

const FUNCTION_KINDS = new Set<vscode.SymbolKind>([
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Constructor
]);

export function isFunctionKind(kind: vscode.SymbolKind): boolean {
    return FUNCTION_KINDS.has(kind);
}

/** Walk a forest depth-first, in place order. */
export function* walk(nodes: readonly SymbolNode[]): Generator<SymbolNode> {
    for (const node of nodes) {
        yield node;
        yield* walk(node.children);
    }
}

/** Assign parents, depths and ids to a freshly built forest. */
export function link(nodes: SymbolNode[], parent?: SymbolNode, prefix = ''): number {
    let count = 0;
    nodes.forEach((node, index) => {
        node.parent = parent;
        node.depth = parent ? parent.depth + 1 : 0;
        // Position is part of the id so that renaming a symbol invalidates it,
        // which is what we want: a renamed node is conceptually a new node.
        node.id = `${prefix}${index}:${node.kind}:${node.name}@${node.range.start.line}`;
        count += 1 + link(node.children, node, `${node.id}/`);
    });
    return count;
}

/**
 * Deepest node whose range contains `position`. Returns undefined when the
 * position sits outside every symbol (blank lines, imports, and so on).
 */
export function findEnclosing(nodes: readonly SymbolNode[], position: vscode.Position): SymbolNode | undefined {
    for (const node of nodes) {
        if (node.range.contains(position)) {
            return findEnclosing(node.children, position) ?? node;
        }
    }
    return undefined;
}

/** `Outer > inner > leaf` breadcrumb for a node. */
export function qualifiedPath(node: SymbolNode, separator = ' > '): string {
    const parts: string[] = [];
    let current: SymbolNode | undefined = node;
    while (current) {
        parts.unshift(current.name);
        current = current.parent;
    }
    return parts.join(separator);
}
