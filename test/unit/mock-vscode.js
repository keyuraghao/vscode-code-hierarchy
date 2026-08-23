'use strict';
/** Minimal stand-in for the parts of the `vscode` API the parser touches. */

class Position {
    constructor(line, character) {
        this.line = line;
        this.character = character;
    }
    compareTo(other) {
        return this.line - other.line || this.character - other.character;
    }
    isBeforeOrEqual(other) {
        return this.compareTo(other) <= 0;
    }
    isAfterOrEqual(other) {
        return this.compareTo(other) >= 0;
    }
}

class Range {
    constructor(a, b, c, d) {
        if (a instanceof Position) {
            this.start = a;
            this.end = b;
        } else {
            this.start = new Position(a, b);
            this.end = new Position(c, d);
        }
    }
    contains(target) {
        const position = target instanceof Range ? target.start : target;
        const end = target instanceof Range ? target.end : target;
        return position.isAfterOrEqual(this.start) && end.isBeforeOrEqual(this.end);
    }
}

const SymbolKind = {
    File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6,
    Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12,
    Constant: 13, String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18,
    Key: 19, Null: 20, EnumMember: 21, Struct: 22, Event: 23, Operator: 24,
    TypeParameter: 25
};
const KIND_NAMES = Object.fromEntries(Object.entries(SymbolKind).map(([k, v]) => [v, k]));

class EventEmitter {
    constructor() { this.listeners = []; }
    get event() { return listener => { this.listeners.push(listener); return { dispose() {} }; }; }
    fire(value) { this.listeners.forEach(listener => listener(value)); }
    dispose() { this.listeners = []; }
}

class TreeItem {
    constructor(label, collapsibleState) {
        this.label = label;
        this.collapsibleState = collapsibleState;
    }
}

class MarkdownString {
    constructor() { this.value = ''; }
    appendMarkdown(text) { this.value += text; return this; }
}

module.exports = {
    Position,
    Range,
    SymbolKind,
    EventEmitter,
    TreeItem,
    MarkdownString,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    KIND_NAMES,
    Uri: { parse: value => ({ toString: () => value, scheme: 'file' }) },
    ThemeIcon: class { constructor(id) { this.id = id; } }
};
