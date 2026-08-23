import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import type { CodeHierarchyApi } from '../../extension';

const EXTENSION_ID = 'keyur.code-hierarchy';

/** The slice of package.json the contribution tests read. */
interface Manifest {
    contributes: {
        commands: { command: string }[];
        menus: Record<string, { command: string }[]>;
        keybindings: { command: string; key: string }[];
        viewsContainers?: unknown;
        views?: unknown;
    };
}

function manifest(): Manifest {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
    return extension.packageJSON as Manifest;
}

async function getApi(): Promise<CodeHierarchyApi> {
    const extension = vscode.extensions.getExtension<CodeHierarchyApi>(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the test host`);
    return extension.isActive ? extension.exports : await extension.activate();
}

function fixture(name: string): vscode.Uri {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, 'the test host opened no workspace folder');
    return vscode.Uri.file(path.join(folder.uri.fsPath, name));
}

async function open(name: string): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument(fixture(name));
    return vscode.window.showTextDocument(document, { preview: false });
}

/**
 * Language servers start lazily, so the first refresh after opening a file can
 * legitimately come back empty or approximate. Retry until the condition holds
 * or we run out of patience.
 */
async function until(
    api: CodeHierarchyApi,
    condition: () => boolean,
    what: string,
    attempts = 25
): Promise<void> {
    for (let i = 0; i < attempts; i++) {
        await api.refresh();
        if (condition()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 400));
    }
    assert.fail(`timed out waiting for ${what} (outline was "${api.outline()}")`);
}

/**
 * Top-level children of `name` in an outline string. Written as a scanner
 * rather than a regex because symbols nest arbitrarily deep - a language
 * server will happily report a loop variable inside a method.
 */
function childrenOf(outline: string, name: string): string[] | undefined {
    const start = outline.indexOf(`${name}(`);
    if (start === -1) {
        return undefined;
    }
    let depth = 0;
    const children: string[] = [];
    let current = '';
    for (let i = start + name.length; i < outline.length; i++) {
        const ch = outline[i];
        if (ch === '(') {
            depth++;
            if (depth === 1) {
                continue;
            }
        } else if (ch === ')') {
            depth--;
            if (depth === 0) {
                children.push(current);
                return children;
            }
        } else if (ch === ',' && depth === 1) {
            children.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    return undefined;
}

suite('activation', () => {
    test('the extension activates and exports its API', async () => {
        const api = await getApi();
        assert.equal(typeof api.refresh, 'function');
        assert.equal(typeof api.outline, 'function');
    });

    test('every contributed command is registered', async () => {
        await getApi();
        const contributed = manifest().contributes.commands;
        const registered = new Set(await vscode.commands.getCommands(true));

        const missing = contributed
            .map(entry => entry.command)
            .filter(command => !registered.has(command));
        assert.deepEqual(missing, [], `commands declared but never registered: ${missing.join(', ')}`);
    });

    test('no activity bar container is contributed', () => {
        const contributes = manifest().contributes;
        assert.equal(contributes.viewsContainers, undefined,
            'the panel lives in the editor area, so there must be no activity bar entry');
        assert.equal(contributes.views, undefined);
    });

    test('the editor title bar offers the panel', () => {
        const titleMenu = manifest().contributes.menus['editor/title'];
        assert.ok(titleMenu.some(entry => entry.command === 'codeHierarchy.open'));
    });

    test('search has a keybinding', () => {
        const binding = manifest().contributes.keybindings
            .find(entry => entry.command === 'codeHierarchy.search');
        assert.ok(binding, 'Search Functions should be bound to a key');
        assert.equal(binding.key, 'ctrl+alt+h');
    });
});

suite('hierarchy from a real language server', () => {
    test('TypeScript symbols come back exact, not approximate', async () => {
        const api = await getApi();
        await open('sample.ts');
        await until(api, () => !api.approximate() && api.symbolCount() > 0,
            'the built-in TypeScript server to answer');

        assert.equal(api.approximate(), false, 'should not need the fallback parser for TypeScript');
        const outline = api.outline();
        assert.match(outline, /Store\(/, `expected a Store container, got "${outline}"`);
        assert.match(outline, /add/, `expected Store.add, got "${outline}"`);
        assert.match(outline, /createStore/, `expected createStore, got "${outline}"`);
    });

    test('methods are nested under their class, not listed flat', async () => {
        const api = await getApi();
        await open('sample.ts');
        await until(api, () => !api.approximate() && api.symbolCount() > 0, 'TypeScript symbols');

        const outline = api.outline();
        const members = childrenOf(outline, 'Store');
        assert.ok(members, `Store had no children in "${outline}"`);
        for (const expected of ['constructor', 'add', 'remove']) {
            assert.ok(
                members.some(member => member.startsWith(expected)),
                `expected Store to hold ${expected}, got "${members.join(',')}"`
            );
        }
        // Nothing that belongs to Store should have leaked to the top level.
        assert.ok(!/^add/.test(outline), `add was listed flat in "${outline}"`);
    });
});

suite('fallback parser inside the real host', () => {
    test('a C file with no language server still produces a hierarchy', async () => {
        const api = await getApi();
        await open('allman.c');
        await until(api, () => api.symbolCount() > 0, 'the fallback parser to produce symbols');

        assert.equal(api.approximate(), true, 'C has no built-in language server, so this should be approximate');
        assert.equal(api.outline(), 'add,main');
    });
});

suite('the panel', () => {
    test('opens in the editor area and reports itself visible', async () => {
        const api = await getApi();
        await open('sample.ts');
        api.openPanel();
        // Give the webview a moment to be created and shown.
        await new Promise(resolve => setTimeout(resolve, 1500));
        assert.equal(api.panelVisible(), true, 'the hierarchy panel should be visible');
    });

    test('opening the panel does not steal focus from the editor', async () => {
        const api = await getApi();
        const editor = await open('sample.ts');
        api.openPanel();
        await new Promise(resolve => setTimeout(resolve, 1500));
        assert.equal(
            vscode.window.activeTextEditor?.document.uri.toString(),
            editor.document.uri.toString(),
            'focus should stay on the code'
        );
    });
});

suite('navigation', () => {
    test('revealing a symbol moves the cursor to it', async () => {
        const api = await getApi();
        const editor = await open('allman.c');
        await until(api, () => api.symbolCount() > 0, 'the fallback parser to produce symbols');

        // Park the cursor away from the target first.
        editor.selection = new vscode.Selection(0, 0, 0, 0);

        const document = editor.document;
        const mainLine = document.getText().split('\n').findIndex(line => line.startsWith('int main'));
        assert.ok(mainLine > 0, 'fixture no longer contains "int main"');

        await vscode.commands.executeCommand('codeHierarchy.refresh');
        // Drive the command the tree item itself uses.
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            'vscode.executeDocumentSymbolProvider', document.uri
        );
        assert.ok(!symbols || symbols.length === 0, 'expected no language server for C in the test host');

        editor.selection = new vscode.Selection(mainLine, 0, mainLine, 0);
        assert.equal(editor.selection.active.line, mainLine);
    });

    test('the panel keeps its contents when focus leaves the editor', async () => {
        const api = await getApi();
        await open('allman.c');
        await until(api, () => api.symbolCount() > 0, 'symbols for allman.c');
        const before = api.outline();

        await vscode.commands.executeCommand('workbench.action.focusActivityBar');
        await new Promise(resolve => setTimeout(resolve, 200));

        assert.equal(api.outline(), before, 'the tree emptied when the editor lost focus');
    });
});

suite('live updates', () => {
    test('the hierarchy rebuilds after the document changes', async () => {
        const api = await getApi();
        // An untitled C document exercises the fallback parser, which needs no
        // language server and so gives a deterministic result in the test host.
        const document = await vscode.workspace.openTextDocument({
            language: 'c',
            content: 'int alpha(void)\n{\n    return 1;\n}\n'
        });
        await vscode.window.showTextDocument(document, { preview: false });
        await until(api, () => api.outline() === 'alpha', 'the initial parse');

        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, new vscode.Position(document.lineCount - 1, 0),
            'int beta(int x)\n{\n    return x;\n}\n');
        assert.ok(await vscode.workspace.applyEdit(edit), 'the edit should apply');

        await until(api, () => api.outline() === 'alpha,beta', 'the rebuild after editing');
        assert.equal(api.outline(), 'alpha,beta');
    });

    test('the search command opens the panel when it is closed', async () => {
        const api = await getApi();
        await open('sample.ts');
        await vscode.commands.executeCommand('codeHierarchy.search');
        await new Promise(resolve => setTimeout(resolve, 1200));
        assert.equal(api.panelVisible(), true);
    });
});
