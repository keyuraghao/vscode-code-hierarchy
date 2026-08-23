import './style.css';
import { Kind, PlainNode, ShapeOptions, SortOrder, findEnclosing, shape } from '../shape';

/** Injected by VS Code into every webview. */
declare function acquireVsCodeApi(): {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

/** Messages the extension host sends us. */
type Incoming =
    | { type: 'hierarchy'; fileName: string; languageId: string; approximate: boolean; nodes: PlainNode[] }
    | { type: 'cursor'; line: number }
    | { type: 'empty'; reason: string }
    | { type: 'config'; functionsOnly: boolean; sortOrder: SortOrder; showDetail: boolean; showLineNumbers: boolean }
    | { type: 'focusSearch' };

const CODICON_BY_KIND: Record<number, string> = {
    [Kind.File]: 'symbol-file',
    [Kind.Module]: 'symbol-module',
    [Kind.Namespace]: 'symbol-namespace',
    [Kind.Package]: 'symbol-package',
    [Kind.Class]: 'symbol-class',
    [Kind.Method]: 'symbol-method',
    [Kind.Property]: 'symbol-property',
    [Kind.Field]: 'symbol-field',
    [Kind.Constructor]: 'symbol-constructor',
    [Kind.Enum]: 'symbol-enum',
    [Kind.Interface]: 'symbol-interface',
    [Kind.Function]: 'symbol-method',
    [Kind.Variable]: 'symbol-variable',
    [Kind.Constant]: 'symbol-constant',
    [Kind.String]: 'symbol-string',
    [Kind.Number]: 'symbol-numeric',
    [Kind.Boolean]: 'symbol-boolean',
    [Kind.Array]: 'symbol-array',
    [Kind.Object]: 'symbol-object',
    [Kind.Key]: 'symbol-key',
    [Kind.Null]: 'symbol-misc',
    [Kind.EnumMember]: 'symbol-enum-member',
    [Kind.Struct]: 'symbol-structure',
    [Kind.Event]: 'symbol-event',
    [Kind.Operator]: 'symbol-operator',
    [Kind.TypeParameter]: 'symbol-parameter'
};

const COLOUR_CLASS_BY_KIND: Record<number, string> = {
    [Kind.Class]: 'kind-class',
    [Kind.Method]: 'kind-method',
    [Kind.Function]: 'kind-function',
    [Kind.Constructor]: 'kind-constructor',
    [Kind.Interface]: 'kind-interface',
    [Kind.Struct]: 'kind-struct',
    [Kind.Enum]: 'kind-enum',
    [Kind.EnumMember]: 'kind-enum-member',
    [Kind.Property]: 'kind-property',
    [Kind.Field]: 'kind-field',
    [Kind.Variable]: 'kind-variable',
    [Kind.Constant]: 'kind-constant',
    [Kind.Namespace]: 'kind-namespace',
    [Kind.Module]: 'kind-module',
    [Kind.Event]: 'kind-event',
    [Kind.Operator]: 'kind-operator'
};

interface State {
    nodes: PlainNode[];
    fileName: string;
    approximate: boolean;
    emptyReason: string | undefined;
    query: string;
    functionsOnly: boolean;
    sortOrder: SortOrder;
    showDetail: boolean;
    showLineNumbers: boolean;
    collapsed: Set<string>;
    /** Symbol containing the editor cursor. */
    activeId: string | undefined;
    /** Row the keyboard is on. */
    focusedId: string | undefined;
}

const state: State = {
    nodes: [],
    fileName: '',
    approximate: false,
    emptyReason: 'Open a source file to see its hierarchy.',
    query: '',
    functionsOnly: false,
    sortOrder: 'position',
    showDetail: true,
    showLineNumbers: false,
    collapsed: new Set(),
    activeId: undefined,
    focusedId: undefined
};

const search = document.getElementById('search') as HTMLInputElement;
const clearButton = document.getElementById('clear-search') as HTMLButtonElement;
const tree = document.getElementById('tree') as HTMLDivElement;
const footerFile = document.getElementById('footer-file') as HTMLSpanElement;
const footerCount = document.getElementById('footer-count') as HTMLSpanElement;
const footerApprox = document.getElementById('footer-approx') as HTMLSpanElement;
const functionsButton = document.getElementById('btn-functions') as HTMLButtonElement;
const sortButton = document.getElementById('btn-sort') as HTMLButtonElement;
const collapseButton = document.getElementById('btn-collapse') as HTMLButtonElement;

/** Rows currently rendered, in visual order, for keyboard navigation. */
let visibleRows: { node: PlainNode; element: HTMLDivElement }[] = [];

function options(): ShapeOptions {
    return { query: state.query, functionsOnly: state.functionsOnly, sortOrder: state.sortOrder };
}

function render(): void {
    const shaped = shape(state.nodes, options());
    tree.textContent = '';
    visibleRows = [];

    if (state.emptyReason) {
        tree.appendChild(emptyMessage(state.emptyReason));
    } else if (shaped.nodes.length === 0) {
        tree.appendChild(emptyMessage(
            state.query
                ? `No symbol matches "${state.query}".`
                : state.functionsOnly
                    ? 'No functions in this file.'
                    : 'No symbols in this file.'
        ));
    } else {
        const fragment = document.createDocumentFragment();
        build(shaped.nodes, 0, fragment, shaped.highlights);
        tree.appendChild(fragment);
    }

    const total = countAll(state.nodes);
    const shown = countAll(shaped.nodes);
    footerCount.textContent = state.query && shown !== total
        ? `${shown} of ${total}`
        : `${total}`;
    footerCount.style.display = total ? '' : 'none';
    footerFile.textContent = state.fileName;
    footerApprox.style.display = state.approximate ? '' : 'none';

    functionsButton.classList.toggle('active', state.functionsOnly);
    sortButton.classList.toggle('active', state.sortOrder === 'name');
    document.body.classList.toggle('searching', state.query.length > 0);

    highlightActive();
}

function countAll(nodes: readonly PlainNode[]): number {
    return nodes.reduce((sum, node) => sum + 1 + countAll(node.children), 0);
}

function emptyMessage(text: string): HTMLDivElement {
    const element = document.createElement('div');
    element.className = 'empty';
    element.textContent = text;
    return element;
}

function build(
    nodes: readonly PlainNode[],
    depth: number,
    parent: DocumentFragment | HTMLElement,
    highlights: Map<string, number[]>
): void {
    for (const node of nodes) {
        // A search should show everything it found, regardless of collapse state.
        const collapsed = !state.query && state.collapsed.has(node.id);
        const row = buildRow(node, depth, collapsed, highlights.get(node.id));
        parent.appendChild(row);
        visibleRows.push({ node, element: row });
        if (node.children.length && !collapsed) {
            build(node.children, depth + 1, parent, highlights);
        }
    }
}

function buildRow(
    node: PlainNode,
    depth: number,
    collapsed: boolean,
    hits: number[] | undefined
): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = node.id;
    row.style.paddingLeft = `${4 + depth * 12}px`;
    row.tabIndex = -1;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(depth + 1));
    row.title = `${node.name}${node.detail ? ` ${node.detail}` : ''}  ·  line ${node.line + 1}`;

    const twisty = document.createElement('span');
    twisty.className = node.children.length
        ? `twisty codicon codicon-chevron-${collapsed ? 'right' : 'down'}`
        : 'twisty leaf';
    if (node.children.length) {
        row.setAttribute('aria-expanded', String(!collapsed));
        twisty.addEventListener('click', event => {
            event.stopPropagation();
            toggle(node.id);
        });
    }
    row.appendChild(twisty);

    const icon = document.createElement('span');
    icon.className = `icon codicon codicon-${CODICON_BY_KIND[node.kind] ?? 'symbol-misc'} `
        + (COLOUR_CLASS_BY_KIND[node.kind] ?? '');
    row.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'label';
    appendHighlighted(label, node.name, hits);
    row.appendChild(label);

    if (state.showDetail && node.detail) {
        const detail = document.createElement('span');
        detail.className = 'detail';
        detail.textContent = node.detail;
        row.appendChild(detail);
    }

    if (state.showLineNumbers) {
        const line = document.createElement('span');
        line.className = 'line-number';
        line.textContent = String(node.line + 1);
        row.appendChild(line);
    }

    row.addEventListener('click', () => reveal(node));
    row.addEventListener('dblclick', () => {
        if (node.children.length) {
            toggle(node.id);
        }
    });
    return row;
}

/** Writes the name with the matched characters wrapped for highlighting. */
function appendHighlighted(target: HTMLElement, name: string, hits: number[] | undefined): void {
    if (!hits || hits.length === 0) {
        target.textContent = name;
        return;
    }
    const set = new Set(hits);
    let run = '';
    let runIsHit = set.has(0);
    for (let i = 0; i < name.length; i++) {
        const isHit = set.has(i);
        if (isHit !== runIsHit) {
            flush(target, run, runIsHit);
            run = '';
            runIsHit = isHit;
        }
        run += name[i];
    }
    flush(target, run, runIsHit);
}

function flush(target: HTMLElement, text: string, isHit: boolean): void {
    if (!text) {
        return;
    }
    if (isHit) {
        const mark = document.createElement('span');
        mark.className = 'hit';
        mark.textContent = text;
        target.appendChild(mark);
    } else {
        target.appendChild(document.createTextNode(text));
    }
}

function toggle(id: string): void {
    if (state.collapsed.has(id)) {
        state.collapsed.delete(id);
    } else {
        state.collapsed.add(id);
    }
    render();
}

function reveal(node: PlainNode): void {
    state.focusedId = node.id;
    vscode.postMessage({
        type: 'reveal',
        line: node.line,
        character: node.character,
        endLine: node.endLine
    });
}

function highlightActive(): void {
    for (const { node, element } of visibleRows) {
        element.classList.toggle('active', node.id === state.activeId);
        element.classList.toggle('focused', node.id === state.focusedId);
    }
}

/** Scrolls the cursor's symbol into view without yanking the user around. */
function scrollActiveIntoView(): void {
    const entry = visibleRows.find(row => row.node.id === state.activeId);
    if (!entry) {
        return;
    }
    const box = entry.element.getBoundingClientRect();
    const container = tree.getBoundingClientRect();
    if (box.top < container.top || box.bottom > container.bottom) {
        entry.element.scrollIntoView({ block: 'nearest' });
    }
}

/** Expands every ancestor of a node so it can be seen. */
function expandTo(id: string): boolean {
    let changed = false;
    const walk = (nodes: readonly PlainNode[], trail: string[]): boolean => {
        for (const node of nodes) {
            if (node.id === id) {
                for (const ancestor of trail) {
                    if (state.collapsed.delete(ancestor)) {
                        changed = true;
                    }
                }
                return true;
            }
            if (walk(node.children, [...trail, node.id])) {
                return true;
            }
        }
        return false;
    };
    walk(state.nodes, []);
    return changed;
}

// ---------- input handling ----------

search.addEventListener('input', () => {
    state.query = search.value.trim();
    render();
});

search.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        clearSearch();
        event.preventDefault();
    } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
        // Jump straight from the box into the results.
        if (visibleRows.length) {
            state.focusedId = visibleRows[0].node.id;
            if (event.key === 'Enter') {
                reveal(visibleRows[0].node);
            }
            highlightActive();
            visibleRows[0].element.focus();
            event.preventDefault();
        }
    }
});

function clearSearch(): void {
    search.value = '';
    state.query = '';
    render();
    search.focus();
}

clearButton.addEventListener('click', clearSearch);

functionsButton.addEventListener('click', () => {
    state.functionsOnly = !state.functionsOnly;
    vscode.postMessage({ type: 'setConfig', key: 'functionsOnly', value: state.functionsOnly });
    render();
});

sortButton.addEventListener('click', () => {
    state.sortOrder = state.sortOrder === 'name' ? 'position' : 'name';
    vscode.postMessage({ type: 'setConfig', key: 'sortOrder', value: state.sortOrder });
    render();
});

collapseButton.addEventListener('click', () => {
    if (state.collapsed.size > 0) {
        state.collapsed.clear();
    } else {
        const collectContainers = (nodes: readonly PlainNode[]) => {
            for (const node of nodes) {
                if (node.children.length) {
                    state.collapsed.add(node.id);
                    collectContainers(node.children);
                }
            }
        };
        collectContainers(state.nodes);
    }
    render();
});

tree.addEventListener('keydown', event => {
    const index = visibleRows.findIndex(row => row.node.id === state.focusedId);
    if (event.key === 'ArrowDown') {
        move(Math.min(index + 1, visibleRows.length - 1));
        event.preventDefault();
    } else if (event.key === 'ArrowUp') {
        if (index <= 0) {
            search.focus();
            search.select();
        } else {
            move(index - 1);
        }
        event.preventDefault();
    } else if (event.key === 'ArrowRight' && index >= 0) {
        const node = visibleRows[index].node;
        if (node.children.length && state.collapsed.has(node.id)) {
            toggle(node.id);
        }
        event.preventDefault();
    } else if (event.key === 'ArrowLeft' && index >= 0) {
        const node = visibleRows[index].node;
        if (node.children.length && !state.collapsed.has(node.id)) {
            toggle(node.id);
        }
        event.preventDefault();
    } else if (event.key === 'Enter' && index >= 0) {
        reveal(visibleRows[index].node);
        event.preventDefault();
    }
});

function move(target: number): void {
    const entry = visibleRows[target];
    if (!entry) {
        return;
    }
    state.focusedId = entry.node.id;
    highlightActive();
    entry.element.focus();
    entry.element.scrollIntoView({ block: 'nearest' });
}

// ---------- messages from the extension host ----------

window.addEventListener('message', event => {
    const message = event.data as Incoming;
    switch (message.type) {
        case 'hierarchy': {
            state.nodes = message.nodes;
            state.fileName = message.fileName;
            state.approximate = message.approximate;
            state.emptyReason = undefined;
            render();
            break;
        }
        case 'empty': {
            state.nodes = [];
            state.fileName = '';
            state.approximate = false;
            state.emptyReason = message.reason;
            render();
            break;
        }
        case 'cursor': {
            const node = findEnclosing(shape(state.nodes, options()).nodes, message.line);
            const next = node?.id;
            if (next !== state.activeId) {
                state.activeId = next;
                if (next && expandTo(next)) {
                    render();
                } else {
                    highlightActive();
                }
                scrollActiveIntoView();
            }
            break;
        }
        case 'config': {
            state.functionsOnly = message.functionsOnly;
            state.sortOrder = message.sortOrder;
            state.showDetail = message.showDetail;
            state.showLineNumbers = message.showLineNumbers;
            render();
            break;
        }
        case 'focusSearch': {
            search.focus();
            search.select();
            break;
        }
    }
});

vscode.postMessage({ type: 'ready' });
render();
