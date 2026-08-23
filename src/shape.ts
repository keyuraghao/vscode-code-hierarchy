/**
 * Pure, serialisable view of the hierarchy plus the filtering and search that
 * runs over it. Deliberately free of any `vscode` import: this module is
 * bundled into the webview as well as used by the extension host, and it is
 * what the unit tests exercise.
 */

export interface PlainNode {
    id: string;
    name: string;
    detail: string;
    /** Numeric `vscode.SymbolKind`. */
    kind: number;
    kindName: string;
    /** Zero-based line of the symbol's name. */
    line: number;
    /** Zero-based last line of the symbol's body. */
    endLine: number;
    character: number;
    children: PlainNode[];
}

export type SortOrder = 'position' | 'name';

export interface ShapeOptions {
    query: string;
    functionsOnly: boolean;
    sortOrder: SortOrder;
}

/** Matched character positions in a name, for highlighting search hits. */
export interface Match {
    score: number;
    indices: number[];
}

/** Numeric SymbolKind values, mirrored so this file stays vscode-free. */
export const Kind = {
    File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5,
    Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10,
    Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15,
    Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21,
    Struct: 22, Event: 23, Operator: 24, TypeParameter: 25
} as const;

const FUNCTION_KINDS = new Set<number>([Kind.Function, Kind.Method, Kind.Constructor]);

const CONTAINER_KINDS = new Set<number>([
    Kind.Class, Kind.Interface, Kind.Struct, Kind.Module,
    Kind.Namespace, Kind.Package, Kind.Object, Kind.Enum
]);

export function isFunctionKind(kind: number): boolean {
    return FUNCTION_KINDS.has(kind);
}

/**
 * Case-insensitive subsequence match, the same idea as VS Code's own quick
 * open: "os" finds "OrderService". Consecutive characters and matches at a
 * word boundary score higher, so the closest name floats to the top.
 */
export function match(name: string, query: string): Match | undefined {
    if (!query) {
        return { score: 0, indices: [] };
    }
    const haystack = name.toLowerCase();
    const needle = query.toLowerCase();

    const indices: number[] = [];
    let score = 0;
    let cursor = 0;
    let previousIndex = -2;

    for (const ch of needle) {
        const found = haystack.indexOf(ch, cursor);
        if (found === -1) {
            return undefined;
        }
        indices.push(found);
        // Reward runs of adjacent characters and matches starting a word.
        if (found === previousIndex + 1) {
            score += 8;
        }
        if (found === 0) {
            score += 12;
        } else if (isBoundary(name, found)) {
            score += 6;
        }
        score += 1;
        previousIndex = found;
        cursor = found + 1;
    }
    // Prefer shorter names when scores are otherwise equal.
    score -= Math.floor(name.length / 12);
    return { score, indices };
}

function isBoundary(name: string, index: number): boolean {
    const previous = name[index - 1];
    if (previous === undefined) {
        return true;
    }
    if (previous === '_' || previous === '-' || previous === '.' || previous === '$') {
        return true;
    }
    // camelCase hump
    return previous === previous.toLowerCase() && name[index] === name[index].toUpperCase();
}

interface Shaped {
    nodes: PlainNode[];
    /** Ids that matched the query directly, rather than being kept as ancestors. */
    matched: Set<string>;
    /** Best match score per node id, used for ranking. */
    scores: Map<string, number>;
    /** Matched character indices per node id, for highlighting. */
    highlights: Map<string, number[]>;
}

/**
 * Filters by search query and kind, then sorts. A node survives when it
 * matches, or when one of its descendants does - so a hit stays reachable
 * through its parents.
 */
export function shape(nodes: readonly PlainNode[], options: ShapeOptions): Shaped {
    const matched = new Set<string>();
    const scores = new Map<string, number>();
    const highlights = new Map<string, number[]>();

    const walk = (input: readonly PlainNode[]): PlainNode[] => {
        const kept: PlainNode[] = [];
        for (const node of input) {
            const children = walk(node.children);
            const hit = match(node.name, options.query);
            const kindOk = !options.functionsOnly
                || isFunctionKind(node.kind)
                || CONTAINER_KINDS.has(node.kind);
            const selfMatches = hit !== undefined && kindOk;

            if (!selfMatches && children.length === 0) {
                continue;
            }
            // A container with nothing callable left inside it is noise.
            if (options.functionsOnly && !isFunctionKind(node.kind) && children.length === 0) {
                continue;
            }
            if (selfMatches) {
                matched.add(node.id);
                scores.set(node.id, hit.score);
                if (hit.indices.length) {
                    highlights.set(node.id, hit.indices);
                }
            }
            kept.push({ ...node, children });
        }
        return sort(kept, options, scores);
    };

    return { nodes: walk(nodes), matched, scores, highlights };
}

function sort(nodes: PlainNode[], options: ShapeOptions, scores: Map<string, number>): PlainNode[] {
    if (options.query) {
        // While searching, rank by how well each name matched.
        return nodes.sort((a, b) => {
            const difference = (scores.get(b.id) ?? -1) - (scores.get(a.id) ?? -1);
            return difference !== 0 ? difference : a.line - b.line;
        });
    }
    if (options.sortOrder === 'name') {
        return nodes.sort((a, b) => a.name.localeCompare(b.name) || a.line - b.line);
    }
    return nodes.sort((a, b) => a.line - b.line);
}

/** Deepest node whose body contains `line`. */
export function findEnclosing(nodes: readonly PlainNode[], line: number): PlainNode | undefined {
    for (const node of nodes) {
        if (line >= node.line && line <= node.endLine) {
            return findEnclosing(node.children, line) ?? node;
        }
    }
    return undefined;
}

/** `Outer > inner > leaf` for a node, given the forest it lives in. */
export function pathTo(nodes: readonly PlainNode[], id: string, separator = ' > '): string {
    const search = (input: readonly PlainNode[], trail: string[]): string[] | undefined => {
        for (const node of input) {
            const next = [...trail, node.name];
            if (node.id === id) {
                return next;
            }
            const found = search(node.children, next);
            if (found) {
                return found;
            }
        }
        return undefined;
    };
    return search(nodes, [])?.join(separator) ?? '';
}

export function countNodes(nodes: readonly PlainNode[]): number {
    return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}
