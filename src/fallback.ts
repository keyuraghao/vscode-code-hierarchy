import * as vscode from 'vscode';
import { SymbolNode } from './model';

/**
 * A best-effort structural parser, used only when no language server answers
 * `executeDocumentSymbolProvider` for a file. It is pattern based, so it is
 * wrong sometimes; everything it produces is flagged `approximate` and the UI
 * says so. The goal is "something useful in a .py file with no Python
 * extension installed", not a real parser.
 */

const HASH_COMMENT_LANGUAGES = new Set([
    'python', 'ruby', 'shellscript', 'bash', 'zsh', 'perl', 'r', 'yaml',
    'makefile', 'dockerfile', 'toml', 'elixir', 'julia', 'nim', 'crystal'
]);

/** Languages whose block structure comes from indentation, not braces. */
const INDENT_LANGUAGES = new Set(['python']);

/**
 * Words that look like a call followed by a brace but are not declarations.
 * Only consulted for the loose "typed declaration" patterns - a keyword-led
 * match such as `fn new(...)` or `class new` is unambiguous.
 */
const NOT_DECLARATIONS = new Set([
    'if', 'else', 'for', 'while', 'switch', 'case', 'do', 'try', 'catch', 'finally',
    'return', 'new', 'delete', 'throw', 'typeof', 'sizeof', 'lock', 'using', 'with',
    'match', 'when', 'where', 'in', 'of', 'and', 'or', 'not', 'await', 'yield',
    'foreach', 'unless', 'until', 'select', 'defer', 'go', 'assert', 'print',
    'elif', 'each', 'loop', 'repeat'
]);

const CONTAINER_KINDS: Record<string, vscode.SymbolKind> = {
    class: vscode.SymbolKind.Class,
    interface: vscode.SymbolKind.Interface,
    protocol: vscode.SymbolKind.Interface,
    trait: vscode.SymbolKind.Interface,
    struct: vscode.SymbolKind.Struct,
    record: vscode.SymbolKind.Struct,
    impl: vscode.SymbolKind.Class,
    object: vscode.SymbolKind.Object,
    enum: vscode.SymbolKind.Enum,
    namespace: vscode.SymbolKind.Namespace,
    module: vscode.SymbolKind.Module
};

interface Match {
    name: string;
    kind: vscode.SymbolKind;
    detail: string;
}

interface Pattern {
    re: RegExp;
    /** Fallback kind when no keyword group resolves one. */
    kind?: vscode.SymbolKind;
    /** Group holding a keyword to look up in CONTAINER_KINDS. */
    keywordGroup?: number;
    nameGroup: number;
    /** Loose patterns are checked against NOT_DECLARATIONS; keyword-led ones are not. */
    loose?: boolean;
    /** Only applies when the following line opens a block (Allman braces). */
    needsBraceNext?: boolean;
    refine?: (match: RegExpExecArray, result: Match) => void;
}

const CONTAINER_KEYWORDS = Object.keys(CONTAINER_KINDS).join('|');
const MODIFIERS = 'export|public|private|protected|internal|abstract|final|sealed|static|open|data|pub|declare|default';
const MEMBER_MODIFIERS = 'export|public|private|protected|internal|static|final|abstract|virtual|override|sealed|synchronized|native|extern|inline|unsafe|async|readonly|get|set|new|partial|operator';

/** Tail a typed declaration may carry between `)` and the opening brace. */
const DECLARATION_TAIL = '\\s*(?:const\\s*)?(?:noexcept\\s*)?(?:throws\\s+[\\w.,\\s]+)?(?:(?::|->)\\s*[^;{}]+)?';
const TYPED_DECLARATION =
    `^\\s*(?:(?:${MEMBER_MODIFIERS})\\s+)*` +
    '(?:[A-Za-z_$][\\w$]*(?:\\s*<[^;{}()]*>)?(?:\\s*(?:\\*|&|\\[\\s*\\]))*\\s+)?' +
    '([A-Za-z_$~][\\w$]*)\\s*\\([^;{}]*\\)' + DECLARATION_TAIL;

const PATTERNS: Pattern[] = [
    // Go: type Server struct { ... }, type Reader interface { ... }
    {
        re: /^\s*type\s+([A-Za-z_]\w*)\s+(struct|interface)\b/,
        nameGroup: 1,
        keywordGroup: 2
    },
    // class Foo, struct Foo, impl Foo, namespace Foo, ...
    {
        re: new RegExp(`^\\s*(?:(?:${MODIFIERS})\\s+)*(${CONTAINER_KEYWORDS})\\s+([A-Za-z_$][\\w$]*)`),
        nameGroup: 2,
        keywordGroup: 1
    },
    // function foo(), export async function* foo()
    {
        re: /^\s*(?:(?:export|declare|default|pub)\s+)*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
        kind: vscode.SymbolKind.Function,
        nameGroup: 1
    },
    // Rust: pub async unsafe fn foo()
    {
        re: /^\s*(?:(?:pub(?:\([^)]*\))?|async|unsafe|const|extern(?:\s+"[^"]*")?)\s+)*fn\s+([A-Za-z_]\w*)/,
        kind: vscode.SymbolKind.Function,
        nameGroup: 1
    },
    // Go/Swift: func foo(), func (s *Server) Start()
    {
        re: /^\s*func\s+(?:\(([^)]*)\)\s*)?([A-Za-z_]\w*)\s*[(<]/,
        kind: vscode.SymbolKind.Function,
        nameGroup: 2,
        refine: (match, result) => {
            if (!match[1]) {
                return;
            }
            // A receiver makes it a method; show the receiver type as detail.
            result.kind = vscode.SymbolKind.Method;
            const receiver = match[1].trim().split(/\s+/).pop() ?? '';
            result.detail = receiver ? `(${receiver})` : '';
        }
    },
    // JS/TS: const foo = () => {}, export const foo = async function () {}
    {
        re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/,
        kind: vscode.SymbolKind.Function,
        nameGroup: 1
    },
    // Ruby: def foo, def self.foo
    {
        re: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/,
        kind: vscode.SymbolKind.Function,
        nameGroup: 1
    },
    // `public void save(int x) {`, `int main(void) {`, `add(item): void {`
    {
        re: new RegExp(`${TYPED_DECLARATION}\\{\\s*$`),
        kind: vscode.SymbolKind.Function,
        nameGroup: 1,
        loose: true
    },
    // The same, with the brace on the next line (Allman / K&R C style).
    {
        re: new RegExp(`${TYPED_DECLARATION}$`),
        kind: vscode.SymbolKind.Function,
        nameGroup: 1,
        loose: true,
        needsBraceNext: true
    }
];

interface CleanState {
    inBlockComment: boolean;
    /** The delimiter of an open triple-quoted string, if any. */
    tripleQuote: string | null;
}

function newCleanState(): CleanState {
    return { inBlockComment: false, tripleQuote: null };
}

/** Strip comments and string bodies so brace counting and matching stay sane. */
function cleanLine(line: string, state: CleanState, hashComments: boolean): string {
    let out = '';
    let i = 0;
    while (i < line.length) {
        if (state.tripleQuote) {
            if (line.startsWith(state.tripleQuote, i)) {
                i += 3;
                state.tripleQuote = null;
            } else {
                i++;
            }
            continue;
        }
        if (state.inBlockComment) {
            if (line.startsWith('*/', i)) {
                state.inBlockComment = false;
                i += 2;
            } else {
                i++;
            }
            continue;
        }
        if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
            const delimiter = line.substr(i, 3);
            i += 3;
            const closing = line.indexOf(delimiter, i);
            if (closing === -1) {
                state.tripleQuote = delimiter;
                break;
            }
            i = closing + 3;
            out += ' ';
            continue;
        }
        if (line.startsWith('/*', i)) {
            state.inBlockComment = true;
            i += 2;
            continue;
        }
        if (line.startsWith('//', i)) {
            break;
        }
        if (hashComments && line[i] === '#') {
            break;
        }
        const ch = line[i];
        if (ch === '"' || ch === "'" || ch === '`') {
            // A Rust lifetime (`'a`) is not a string; leave it alone.
            if (ch === "'") {
                const lifetime = /^'[A-Za-z_]\w*/.exec(line.slice(i));
                if (lifetime && line[i + lifetime[0].length] !== "'") {
                    out += ch;
                    i++;
                    continue;
                }
            }
            i++;
            out += ' ';
            while (i < line.length) {
                if (line[i] === '\\') {
                    i += 2;
                    continue;
                }
                if (line[i] === ch) {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

function matchDeclaration(line: string, braceOnNextLine: boolean): Match | undefined {
    for (const pattern of PATTERNS) {
        if (pattern.needsBraceNext && !braceOnNextLine) {
            continue;
        }
        const match = pattern.re.exec(line);
        if (!match) {
            continue;
        }
        const name = match[pattern.nameGroup];
        if (!name || (pattern.loose && NOT_DECLARATIONS.has(name))) {
            continue;
        }
        const keyword = pattern.keywordGroup ? match[pattern.keywordGroup] : undefined;
        const result: Match = {
            name,
            kind: (keyword ? CONTAINER_KINDS[keyword] : undefined)
                ?? pattern.kind
                ?? vscode.SymbolKind.Class,
            detail: ''
        };
        pattern.refine?.(match, result);
        return result;
    }
    return undefined;
}

function isTypeKind(kind: vscode.SymbolKind): boolean {
    return kind === vscode.SymbolKind.Class
        || kind === vscode.SymbolKind.Interface
        || kind === vscode.SymbolKind.Struct
        || kind === vscode.SymbolKind.Object;
}

function makeNode(
    name: string,
    kind: vscode.SymbolKind,
    startLine: number,
    document: vscode.TextDocument,
    detail: string
): SymbolNode {
    const text = document.lineAt(startLine).text;
    const column = Math.max(0, text.indexOf(name));
    return {
        id: '',
        name,
        detail,
        kind,
        range: new vscode.Range(startLine, 0, startLine, text.length),
        selectionRange: new vscode.Range(startLine, column, startLine, column + name.length),
        children: [],
        approximate: true,
        depth: 0
    };
}

function extendTo(node: SymbolNode, endLine: number, document: vscode.TextDocument): void {
    const last = Math.min(Math.max(endLine, node.range.start.line), document.lineCount - 1);
    node.range = new vscode.Range(
        node.range.start,
        new vscode.Position(last, document.lineAt(last).text.length)
    );
}

interface Frame {
    node: SymbolNode;
    /** Brace depth (or indent column) the declaration itself sat at. */
    level: number;
    /** Set once the body of the declaration has actually been entered. */
    opened: boolean;
}

function countBraces(line: string): number {
    let delta = 0;
    for (const ch of line) {
        if (ch === '{') {
            delta++;
        } else if (ch === '}') {
            delta--;
        }
    }
    return delta;
}

function countBrackets(line: string): number {
    let delta = 0;
    for (const ch of line) {
        if (ch === '(' || ch === '[') {
            delta++;
        } else if (ch === ')' || ch === ']') {
            delta--;
        }
    }
    return delta;
}

/** Comments and string bodies removed, one entry per line of the document. */
function cleanAll(document: vscode.TextDocument, hashComments: boolean): string[] {
    const state = newCleanState();
    const lines: string[] = [];
    for (let i = 0; i < document.lineCount; i++) {
        lines.push(cleanLine(document.lineAt(i).text, state, hashComments));
    }
    return lines;
}

/** Brace-depth driven parse for C-like languages. */
function parseBraces(document: vscode.TextDocument, hashComments: boolean): SymbolNode[] {
    const cleaned = cleanAll(document, hashComments);
    const roots: SymbolNode[] = [];
    const stack: Frame[] = [];
    let depth = 0;

    const opensNextLine = (from: number): boolean => {
        for (let i = from + 1; i < cleaned.length; i++) {
            const text = cleaned[i].trim();
            if (!text) {
                continue;
            }
            return text.startsWith('{');
        }
        return false;
    };

    const closeFinished = (level: number, endLine: number) => {
        while (stack.length) {
            const top = stack[stack.length - 1];
            // A frame whose body was never entered (Allman braces, or a
            // declaration we misread) must not be closed by the very next line.
            if (!top.opened || level > top.level) {
                break;
            }
            extendTo(top.node, endLine, document);
            stack.pop();
        }
    };

    for (let lineNumber = 0; lineNumber < cleaned.length; lineNumber++) {
        const line = cleaned[lineNumber];
        if (line.trim()) {
            closeFinished(depth, lineNumber - 1);
            const declaration = matchDeclaration(line, opensNextLine(lineNumber));
            if (declaration) {
                // Two declarations at the same level: the earlier one is done
                // even if we never saw its body open.
                while (stack.length && depth <= stack[stack.length - 1].level) {
                    extendTo(stack[stack.length - 1].node, lineNumber - 1, document);
                    stack.pop();
                }
                const node = makeNode(
                    declaration.name,
                    declaration.kind,
                    lineNumber,
                    document,
                    declaration.detail
                );
                const parent = stack.length ? stack[stack.length - 1].node : undefined;
                if (parent) {
                    if (node.kind === vscode.SymbolKind.Function && isTypeKind(parent.kind)) {
                        node.kind = node.name === parent.name || node.name === 'constructor'
                            ? vscode.SymbolKind.Constructor
                            : vscode.SymbolKind.Method;
                    }
                    parent.children.push(node);
                } else {
                    roots.push(node);
                }
                stack.push({ node, level: depth, opened: false });
            }
        }
        depth = Math.max(0, depth + countBraces(line));
        if (stack.length && depth > stack[stack.length - 1].level) {
            stack[stack.length - 1].opened = true;
        }
    }
    while (stack.length) {
        extendTo(stack[stack.length - 1].node, document.lineCount - 1, document);
        stack.pop();
    }
    return roots;
}

const PY_DECLARATION = /^(\s*)(?:(async)\s+)?(def|class)\s+([A-Za-z_]\w*)\s*[(:[]/;
const PY_CONTINUATION = /^\s*[)\]}.,]|^\s*@|\\$/;

/** Indentation driven parse for Python. */
function parseIndented(document: vscode.TextDocument): SymbolNode[] {
    const roots: SymbolNode[] = [];
    const stack: Frame[] = [];
    const state = newCleanState();
    let bracketDepth = 0;
    let lastCodeLine = 0;

    const closeFinished = (indent: number, endLine: number) => {
        while (stack.length && indent <= stack[stack.length - 1].level) {
            extendTo(stack[stack.length - 1].node, endLine, document);
            stack.pop();
        }
    };

    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
        const raw = document.lineAt(lineNumber).text;
        const continued = bracketDepth > 0 || state.tripleQuote !== null;
        const cleaned = cleanLine(raw, state, true);
        bracketDepth = Math.max(0, bracketDepth + countBrackets(cleaned));

        if (!cleaned.trim() || continued || PY_CONTINUATION.test(raw)) {
            continue;
        }
        lastCodeLine = lineNumber;
        const indent = expandTabs(/^\s*/.exec(raw)![0]);
        closeFinished(indent, lineNumber - 1);

        const match = PY_DECLARATION.exec(raw);
        if (!match) {
            continue;
        }
        const isClass = match[3] === 'class';
        const parent = stack.length ? stack[stack.length - 1].node : undefined;
        const kind = isClass
            ? vscode.SymbolKind.Class
            : parent && parent.kind === vscode.SymbolKind.Class
                ? vscode.SymbolKind.Method
                : vscode.SymbolKind.Function;
        const node = makeNode(match[4], kind, lineNumber, document, match[2] ? 'async' : '');
        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
        stack.push({ node, level: indent, opened: true });
    }
    while (stack.length) {
        extendTo(stack[stack.length - 1].node, lastCodeLine, document);
        stack.pop();
    }
    return roots;
}

function expandTabs(indent: string): number {
    let width = 0;
    for (const ch of indent) {
        width += ch === '\t' ? 4 : 1;
    }
    return width;
}

export function parseFallback(document: vscode.TextDocument): SymbolNode[] {
    if (INDENT_LANGUAGES.has(document.languageId)) {
        return parseIndented(document);
    }
    return parseBraces(document, HASH_COMMENT_LANGUAGES.has(document.languageId));
}
