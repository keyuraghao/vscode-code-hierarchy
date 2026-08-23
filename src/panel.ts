import * as vscode from 'vscode';
import { Hierarchy, SymbolNode } from './model';
import { PlainNode, SortOrder } from './shape';
import { labelForKind } from './icons';
import { log } from './log';

/** What the webview asks the extension host to do. */
export type PanelRequest =
    | { type: 'ready' }
    | { type: 'reveal'; line: number; character: number; endLine: number }
    | { type: 'setConfig'; key: string; value: unknown };

export const VIEW_TYPE = 'codeHierarchy.panel';

/** Converts the vscode-shaped tree into the plain form the webview receives. */
export function toPlainNodes(nodes: readonly SymbolNode[]): PlainNode[] {
    return nodes.map(node => ({
        id: node.id,
        name: node.name,
        detail: node.detail,
        kind: node.kind,
        kindName: labelForKind(node.kind),
        line: node.selectionRange.start.line,
        endLine: node.range.end.line,
        character: node.selectionRange.start.character,
        children: toPlainNodes(node.children)
    }));
}

/**
 * The hierarchy panel itself: a webview docked in the editor area beside the
 * code, rather than a view in the activity bar. One panel per window; it
 * follows whichever editor is active.
 */
export class HierarchyPanel {
    private panel: vscode.WebviewPanel | undefined;
    private readonly disposables: vscode.Disposable[] = [];
    /** Buffered until the webview says it is ready to receive messages. */
    private pending: unknown[] = [];
    private ready = false;

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly onRequest: (request: PanelRequest) => void
    ) {}

    get visible(): boolean {
        return this.panel?.visible ?? false;
    }

    get exists(): boolean {
        return this.panel !== undefined;
    }

    /**
     * Creates the panel if needed and brings it forward. `preserveFocus` keeps
     * the caret in the editor, which is what we want every time the panel opens
     * by itself rather than because the user asked for it.
     */
    show(preserveFocus = true): void {
        if (this.panel) {
            this.panel.reveal(this.panel.viewColumn, preserveFocus);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            'Hierarchy',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus },
            {
                enableScripts: true,
                // Keeps scroll position, collapse state and the search box
                // intact when the user tabs away and back.
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')]
            }
        );
        this.adopt(panel);
    }

    /** Reattaches to a panel VS Code restored after a window reload. */
    adopt(panel: vscode.WebviewPanel): void {
        this.panel?.dispose();
        this.panel = panel;
        this.ready = false;
        this.pending = [];

        panel.iconPath = {
            light: vscode.Uri.joinPath(this.extensionUri, 'resources', 'hierarchy.svg'),
            dark: vscode.Uri.joinPath(this.extensionUri, 'resources', 'hierarchy.svg')
        };
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')]
        };
        panel.webview.html = this.html(panel.webview);

        this.disposables.push(
            panel.webview.onDidReceiveMessage((request: PanelRequest) => {
                if (request.type === 'ready') {
                    this.ready = true;
                    for (const message of this.pending) {
                        void panel.webview.postMessage(message);
                    }
                    this.pending = [];
                }
                this.onRequest(request);
            }),
            panel.onDidDispose(() => {
                log.debug('Hierarchy panel closed.');
                this.panel = undefined;
                this.ready = false;
                this.pending = [];
                this.disposeListeners();
            })
        );
    }

    private post(message: unknown): void {
        if (!this.panel) {
            return;
        }
        if (!this.ready) {
            this.pending.push(message);
            return;
        }
        void this.panel.webview.postMessage(message);
    }

    setHierarchy(hierarchy: Hierarchy, fileName: string): void {
        this.post({
            type: 'hierarchy',
            fileName,
            languageId: hierarchy.languageId,
            approximate: hierarchy.approximate,
            nodes: toPlainNodes(hierarchy.roots)
        });
    }

    setEmpty(reason: string): void {
        this.post({ type: 'empty', reason });
    }

    setCursor(line: number): void {
        this.post({ type: 'cursor', line });
    }

    setConfig(config: {
        functionsOnly: boolean;
        sortOrder: SortOrder;
        showDetail: boolean;
        showLineNumbers: boolean;
    }): void {
        this.post({ type: 'config', ...config });
    }

    focusSearch(): void {
        this.panel?.reveal(this.panel.viewColumn, false);
        this.post({ type: 'focusSearch' });
    }

    private html(webview: vscode.Webview): string {
        // `.toString()` is explicit: a Uri interpolated directly into the HTML
        // would rely on default stringification.
        const asset = (name: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', name)).toString();
        const nonce = makeNonce();

        // Strict policy: no inline script, no remote anything. Styles and the
        // codicon font come from dist/ only.
        const csp = [
            "default-src 'none'",
            `img-src ${webview.cspSource} data:`,
            `style-src ${webview.cspSource}`,
            `font-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${asset('codicon.css')}" rel="stylesheet">
<link href="${asset('webview.css')}" rel="stylesheet">
<title>Hierarchy</title>
</head>
<body>
    <div class="header">
        <div class="search-row">
            <div class="search-box">
                <span class="codicon codicon-search"></span>
                <input id="search" type="text" placeholder="Search functions..."
                       aria-label="Search functions and symbols" spellcheck="false">
                <button id="clear-search" class="clear-search" title="Clear search"
                        aria-label="Clear search">
                    <span class="codicon codicon-close"></span>
                </button>
            </div>
            <div class="toolbar">
                <button id="btn-functions" title="Show functions only"
                        aria-label="Show functions only">
                    <span class="codicon codicon-symbol-method"></span>
                </button>
                <button id="btn-sort" title="Sort by name" aria-label="Sort by name">
                    <span class="codicon codicon-sort-precedence"></span>
                </button>
                <button id="btn-collapse" title="Collapse or expand all"
                        aria-label="Collapse or expand all">
                    <span class="codicon codicon-collapse-all"></span>
                </button>
            </div>
        </div>
    </div>

    <div id="tree" class="tree" role="tree" aria-label="Code hierarchy" tabindex="0"></div>

    <div class="footer">
        <span id="footer-file" class="file"></span>
        <span class="spacer"></span>
        <span id="footer-approx" class="badge warn" title="No language server for this file; symbols were matched by pattern.">approximate</span>
        <span id="footer-count" class="badge"></span>
    </div>

    <script nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`;
    }

    private disposeListeners(): void {
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }

    dispose(): void {
        this.disposeListeners();
        this.panel?.dispose();
        this.panel = undefined;
    }
}

function makeNonce(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let value = '';
    for (let i = 0; i < 32; i++) {
        value += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return value;
}
