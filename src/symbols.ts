import * as vscode from 'vscode';
import { Hierarchy, SymbolNode, link } from './model';
import { parseFallback } from './fallback';

/**
 * Language servers are often still starting up when the first editor opens, and
 * they answer with an empty array rather than an error. Retry a few times with
 * a short backoff before falling back to the pattern parser.
 */
const RETRY_DELAYS_MS = [0, 150, 400, 900];

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

type ProviderResult = vscode.DocumentSymbol[] | vscode.SymbolInformation[] | undefined;

function isDocumentSymbol(item: vscode.DocumentSymbol | vscode.SymbolInformation): item is vscode.DocumentSymbol {
    return (item as vscode.DocumentSymbol).selectionRange !== undefined;
}

function fromDocumentSymbol(symbol: vscode.DocumentSymbol): SymbolNode {
    return {
        id: '',
        name: symbol.name,
        detail: symbol.detail ?? '',
        kind: symbol.kind,
        range: symbol.range,
        selectionRange: symbol.selectionRange,
        children: (symbol.children ?? []).map(fromDocumentSymbol),
        approximate: false,
        depth: 0
    };
}

/**
 * Some providers still return the flat `SymbolInformation[]` shape. Rebuild a
 * tree from it by nesting each symbol under the smallest symbol that fully
 * contains it.
 */
function fromSymbolInformation(symbols: vscode.SymbolInformation[], uri: vscode.Uri): SymbolNode[] {
    const nodes = symbols
        .filter(symbol => symbol.location.uri.toString() === uri.toString())
        .map<SymbolNode>(symbol => ({
            id: '',
            name: symbol.name,
            detail: symbol.containerName ?? '',
            kind: symbol.kind,
            range: symbol.location.range,
            selectionRange: symbol.location.range,
            children: [],
            approximate: false,
            depth: 0
        }))
        .sort((a, b) => {
            const start = a.range.start.compareTo(b.range.start);
            // Wider ranges first so a container is seen before its members.
            return start !== 0 ? start : b.range.end.compareTo(a.range.end);
        });

    const roots: SymbolNode[] = [];
    const stack: SymbolNode[] = [];
    for (const node of nodes) {
        while (stack.length && !stack[stack.length - 1].range.contains(node.range)) {
            stack.pop();
        }
        if (stack.length) {
            stack[stack.length - 1].children.push(node);
        } else {
            roots.push(node);
        }
        stack.push(node);
    }
    return roots;
}

function convert(result: ProviderResult, uri: vscode.Uri): SymbolNode[] {
    if (!result || result.length === 0) {
        return [];
    }
    if (isDocumentSymbol(result[0])) {
        return (result as vscode.DocumentSymbol[]).map(fromDocumentSymbol);
    }
    return fromSymbolInformation(result as vscode.SymbolInformation[], uri);
}

export interface FetchOptions {
    useFallback: boolean;
    token?: vscode.CancellationToken;
}

/**
 * Returns undefined when the work was abandoned - the document was edited or
 * the request was cancelled - so the caller can leave the current tree alone
 * instead of flashing a half-built one.
 */
export async function fetchHierarchy(
    document: vscode.TextDocument,
    options: FetchOptions
): Promise<Hierarchy | undefined> {
    const version = document.version;
    let nodes: SymbolNode[] = [];
    let approximate = false;

    for (const wait of RETRY_DELAYS_MS) {
        if (options.token?.isCancellationRequested) {
            return undefined;
        }
        if (wait > 0) {
            await delay(wait);
            // The document changed underneath us; a newer refresh is coming.
            if (document.version !== version) {
                return undefined;
            }
        }
        let result: ProviderResult;
        try {
            result = await vscode.commands.executeCommand<ProviderResult>(
                'vscode.executeDocumentSymbolProvider',
                document.uri
            );
        } catch {
            result = undefined;
        }
        nodes = convert(result, document.uri);
        if (nodes.length) {
            break;
        }
    }

    if (options.token?.isCancellationRequested) {
        return undefined;
    }
    if (!nodes.length && options.useFallback) {
        nodes = parseFallback(document);
        approximate = nodes.length > 0;
    }

    const count = link(nodes);
    return {
        uri: document.uri,
        languageId: document.languageId,
        version,
        roots: nodes,
        approximate,
        count
    };
}
