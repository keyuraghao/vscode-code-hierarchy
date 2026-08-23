import * as vscode from 'vscode';
import { fetchHierarchy } from './symbols';
import { EMPTY_HIERARCHY, Hierarchy, findEnclosing, qualifiedPath } from './model';
import { HierarchyPanel, PanelRequest, VIEW_TYPE, toPlainNodes } from './panel';
import { SortOrder } from './shape';
import { labelForKind } from './icons';
import { describeError, initLogger, log } from './log';

/** Document schemes that never contain source worth outlining. */
const IGNORED_SCHEMES = new Set(['output', 'search-result', 'vscode-terminal', 'comment', 'git-index']);
const IGNORED_LANGUAGES = new Set(['log', 'search-result', 'code-text-output']);

/** Above this, the pattern fallback is skipped: it is O(lines) but not free. */
const FALLBACK_LINE_LIMIT = 50_000;

/** How long the clicked symbol stays highlighted, in milliseconds. */
const HIGHLIGHT_DURATION_MS = 700;

let panel: HierarchyPanel;
let statusBar: vscode.StatusBarItem;
let highlight: vscode.TextEditorDecorationType;

let refreshTimer: NodeJS.Timeout | undefined;
let highlightTimer: NodeJS.Timeout | undefined;
let pendingRefresh: vscode.CancellationTokenSource | undefined;
let currentDocument: vscode.TextDocument | undefined;
let hierarchy: Hierarchy = EMPTY_HIERARCHY;

interface Settings {
    autoOpen: boolean;
    followCursor: boolean;
    functionsOnly: boolean;
    sortOrder: SortOrder;
    showDetail: boolean;
    showLineNumbers: boolean;
    refreshDelay: number;
    useFallbackParser: boolean;
    showStatusBar: boolean;
    highlightOnReveal: boolean;
}

function settings(): Settings {
    const config = vscode.workspace.getConfiguration('codeHierarchy');
    return {
        autoOpen: config.get('autoOpen', true),
        followCursor: config.get('followCursor', true),
        functionsOnly: config.get('functionsOnly', false),
        sortOrder: config.get<SortOrder>('sortOrder', 'position'),
        showDetail: config.get('showDetail', true),
        showLineNumbers: config.get('showLineNumbers', false),
        refreshDelay: config.get('refreshDelay', 400),
        useFallbackParser: config.get('useFallbackParser', true),
        showStatusBar: config.get('showStatusBar', true),
        highlightOnReveal: config.get('highlightOnReveal', true)
    };
}

function isSupported(document: vscode.TextDocument): boolean {
    return !IGNORED_SCHEMES.has(document.uri.scheme) && !IGNORED_LANGUAGES.has(document.languageId);
}

function activeSourceEditor(): vscode.TextEditor | undefined {
    const editor = vscode.window.activeTextEditor;
    return editor && isSupported(editor.document) ? editor : undefined;
}

function describes(document: vscode.TextDocument | undefined): boolean {
    return currentDocument !== undefined
        && document !== undefined
        && document.uri.toString() === currentDocument.uri.toString();
}

function pushConfig(): void {
    const current = settings();
    panel.setConfig({
        functionsOnly: current.functionsOnly,
        sortOrder: current.sortOrder,
        showDetail: current.showDetail,
        showLineNumbers: current.showLineNumbers
    });
}

function updateStatusBar(editor: vscode.TextEditor | undefined): void {
    if (!settings().showStatusBar || !editor || !describes(editor.document)) {
        statusBar.hide();
        return;
    }
    const node = findEnclosing(hierarchy.roots, editor.selection.active);
    if (!node) {
        statusBar.hide();
        return;
    }
    statusBar.text = `$(list-tree) ${qualifiedPath(node, ' › ')}`;
    statusBar.tooltip = `${labelForKind(node.kind)} - click to focus the hierarchy panel`;
    statusBar.show();
}

async function refresh(editor: vscode.TextEditor | undefined): Promise<void> {
    pendingRefresh?.cancel();
    pendingRefresh?.dispose();
    pendingRefresh = undefined;

    if (!editor) {
        currentDocument = undefined;
        hierarchy = EMPTY_HIERARCHY;
        panel.setEmpty('Open a source file to see its hierarchy.');
        updateStatusBar(undefined);
        return;
    }

    const source = new vscode.CancellationTokenSource();
    pendingRefresh = source;
    currentDocument = editor.document;

    const current = settings();
    const useFallback = current.useFallbackParser && editor.document.lineCount <= FALLBACK_LINE_LIMIT;

    try {
        const started = Date.now();
        const result = await fetchHierarchy(editor.document, { useFallback, token: source.token });
        if (!result || source.token.isCancellationRequested) {
            log.trace(`Refresh abandoned for ${editor.document.uri.fsPath}`);
            return;
        }
        log.debug(
            `Built ${result.count} symbol(s) for ${editor.document.uri.fsPath} `
            + `in ${Date.now() - started}ms${result.approximate ? ' (approximate)' : ''}`
        );
        hierarchy = result;
        panel.setHierarchy(result, workspaceRelative(editor.document.uri));
        updateStatusBar(vscode.window.activeTextEditor);
        followCursor(vscode.window.activeTextEditor);
    } catch (error) {
        log.error(`Failed to build the hierarchy for ${editor.document.uri.toString()}`, error);
        hierarchy = EMPTY_HIERARCHY;
        panel.setEmpty('Could not read the symbols for this file. See the Code Hierarchy log.');
    } finally {
        if (pendingRefresh === source) {
            pendingRefresh = undefined;
        }
        source.dispose();
    }
}

function workspaceRelative(uri: vscode.Uri): string {
    return vscode.workspace.asRelativePath(uri, false);
}

function scheduleRefresh(editor: vscode.TextEditor | undefined, immediate = false): void {
    if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
    }
    if (immediate) {
        void refresh(editor);
        return;
    }
    refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refresh(editor);
    }, Math.max(0, settings().refreshDelay));
}

function followCursor(editor: vscode.TextEditor | undefined): void {
    if (!editor || !describes(editor.document) || !panel.exists) {
        return;
    }
    if (!settings().followCursor) {
        return;
    }
    panel.setCursor(editor.selection.active.line);
}

async function revealAt(line: number, character: number, endLine: number): Promise<void> {
    const document = currentDocument;
    if (!document) {
        return;
    }
    const editor = await vscode.window.showTextDocument(document, {
        preserveFocus: true,
        preview: false,
        viewColumn: vscode.ViewColumn.One
    });

    const lastLine = Math.max(0, editor.document.lineCount - 1);
    if (line > lastLine) {
        log.warn('The panel is behind the document; refreshing instead of jumping.');
        scheduleRefresh(editor, true);
        return;
    }

    const target = new vscode.Position(line, character);
    editor.selection = new vscode.Selection(target, target);
    const body = new vscode.Range(line, 0, Math.min(endLine, lastLine), 0);
    editor.revealRange(body, vscode.TextEditorRevealType.InCenterIfOutsideViewport);

    if (settings().highlightOnReveal) {
        clearHighlight();
        editor.setDecorations(highlight, [body]);
        highlightTimer = setTimeout(() => {
            highlightTimer = undefined;
            try {
                editor.setDecorations(highlight, []);
            } catch (error) {
                log.trace(`Could not clear the highlight: ${describeError(error)}`);
            }
        }, HIGHLIGHT_DURATION_MS);
    }
    updateStatusBar(editor);
}

function clearHighlight(): void {
    if (highlightTimer) {
        clearTimeout(highlightTimer);
        highlightTimer = undefined;
    }
}

function handlePanelRequest(request: PanelRequest): void {
    switch (request.type) {
        case 'ready':
            pushConfig();
            if (currentDocument && hierarchy.count > 0) {
                panel.setHierarchy(hierarchy, workspaceRelative(currentDocument.uri));
                followCursor(vscode.window.activeTextEditor);
            } else {
                scheduleRefresh(activeSourceEditor(), true);
            }
            break;
        case 'reveal':
            void revealAt(request.line, request.character, request.endLine).catch((error: unknown) =>
                log.error('Could not jump to the symbol', error));
            break;
        case 'setConfig':
            void vscode.workspace
                .getConfiguration('codeHierarchy')
                .update(request.key, request.value, vscode.ConfigurationTarget.Global)
                .then(undefined, (error: unknown) => log.error(`Could not save ${request.key}`, error));
            break;
    }
}

/** Opens the panel by itself when the user lands on a source file. */
function maybeAutoOpen(): void {
    if (!settings().autoOpen || panel.exists) {
        return;
    }
    if (!activeSourceEditor()) {
        return;
    }
    panel.show(true);
}

export interface CodeHierarchyApi {
    refresh(): Promise<void>;
    outline(): string;
    symbolCount(): number;
    approximate(): boolean;
    documentUri(): string | undefined;
    panelVisible(): boolean;
    openPanel(): void;
}

function renderOutline(nodes: ReturnType<typeof toPlainNodes>): string {
    return nodes
        .map(node => (node.children.length ? `${node.name}(${renderOutline(node.children)})` : node.name))
        .join(',');
}

function guard<A extends unknown[]>(
    name: string,
    handler: (...args: A) => unknown
): (...args: A) => Promise<void> {
    return async (...args: A) => {
        try {
            await handler(...args);
        } catch (error) {
            log.error(`Command ${name} failed`, error);
            const choice = await vscode.window.showErrorMessage(
                `Code Hierarchy: ${name} failed. ${error instanceof Error ? error.message : describeError(error)}`,
                'Show Log'
            );
            if (choice === 'Show Log') {
                log.show();
            }
        }
    };
}

export function activate(context: vscode.ExtensionContext): CodeHierarchyApi {
    initLogger(context);
    log.info(`Code Hierarchy activated (VS Code ${vscode.version}).`);

    panel = new HierarchyPanel(context.extensionUri, handlePanelRequest);

    statusBar = vscode.window.createStatusBarItem(
        'codeHierarchy.breadcrumb',
        vscode.StatusBarAlignment.Left,
        90
    );
    statusBar.name = 'Code Hierarchy';
    statusBar.command = 'codeHierarchy.search';

    highlight = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
        isWholeLine: true
    });

    context.subscriptions.push(
        statusBar,
        highlight,
        new vscode.Disposable(() => {
            if (refreshTimer) {
                clearTimeout(refreshTimer);
                refreshTimer = undefined;
            }
            clearHighlight();
            pendingRefresh?.cancel();
            pendingRefresh?.dispose();
            pendingRefresh = undefined;
            panel.dispose();
        }),

        // Bring the panel back where it was after a window reload.
        vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
            deserializeWebviewPanel(restored: vscode.WebviewPanel) {
                panel.adopt(restored);
                return Promise.resolve();
            }
        }),

        vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor || !isSupported(editor.document)) {
                return;
            }
            maybeAutoOpen();
            scheduleRefresh(editor, true);
        }),

        vscode.workspace.onDidChangeTextDocument(event => {
            const editor = activeSourceEditor();
            if (editor && event.document === editor.document && event.contentChanges.length > 0) {
                scheduleRefresh(editor);
            }
        }),

        vscode.workspace.onDidCloseTextDocument(document => {
            if (describes(document)) {
                scheduleRefresh(activeSourceEditor(), true);
            }
        }),

        vscode.window.onDidChangeTextEditorSelection(event => {
            if (event.textEditor === vscode.window.activeTextEditor) {
                followCursor(event.textEditor);
                updateStatusBar(event.textEditor);
            }
        }),

        vscode.workspace.onDidChangeConfiguration(event => {
            if (!event.affectsConfiguration('codeHierarchy')) {
                return;
            }
            pushConfig();
            updateStatusBar(vscode.window.activeTextEditor);
        })
    );

    const register = (command: string, name: string, handler: (...args: never[]) => unknown) =>
        context.subscriptions.push(vscode.commands.registerCommand(command, guard(name, handler)));

    register('codeHierarchy.open', 'Open Hierarchy', () => {
        panel.show(false);
        scheduleRefresh(activeSourceEditor(), true);
    });

    register('codeHierarchy.search', 'Search Functions', () => {
        if (!panel.exists) {
            panel.show(false);
        }
        panel.focusSearch();
    });

    register('codeHierarchy.refresh', 'Refresh', () => scheduleRefresh(activeSourceEditor(), true));

    register('codeHierarchy.toggleFollowCursor', 'Toggle Follow Cursor', async () => {
        const config = vscode.workspace.getConfiguration('codeHierarchy');
        const next = !config.get<boolean>('followCursor', true);
        await config.update('followCursor', next, vscode.ConfigurationTarget.Global);
        void vscode.window.showInformationMessage(`Code Hierarchy: follow cursor ${next ? 'on' : 'off'}.`);
    });

    register('codeHierarchy.showLog', 'Show Log', () => log.show());

    maybeAutoOpen();
    scheduleRefresh(activeSourceEditor(), true);

    return {
        refresh: () => refresh(activeSourceEditor()),
        outline: () => renderOutline(toPlainNodes(hierarchy.roots)),
        symbolCount: () => hierarchy.count,
        approximate: () => hierarchy.approximate,
        documentUri: () => currentDocument?.uri.toString(),
        panelVisible: () => panel.visible,
        openPanel: () => panel.show(true)
    };
}

export function deactivate(): void {
    log.info('Code Hierarchy deactivated.');
}
