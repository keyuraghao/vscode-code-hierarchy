'use strict';
/**
 * Lets the compiled extension modules run under plain Node by intercepting
 * `require('vscode')` before anything from `out/` is loaded.
 */
const Module = require('module');
const path = require('path');
const fs = require('fs');

const mock = require('./mock-vscode');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    return request === 'vscode' ? mock : originalLoad(request, parent, isMain);
};

const LANGUAGE_BY_EXTENSION = {
    '.py': 'python',
    '.ts': 'typescript',
    '.js': 'javascript',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.c': 'c',
    '.cpp': 'cpp',
    '.rb': 'ruby'
};

const FIXTURES = path.join(__dirname, '..', 'fixtures');

/** A stand-in for `vscode.TextDocument` with just the members the parser uses. */
function fakeDocument(text, languageId, uri = 'file:///fixture') {
    const lines = text.split('\n');
    return {
        languageId,
        lineCount: lines.length,
        uri: mock.Uri.parse(uri),
        version: 1,
        lineAt: n => ({ text: lines[n], lineNumber: n })
    };
}

function loadFixture(name) {
    const source = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
    const languageId = LANGUAGE_BY_EXTENSION[path.extname(name)] || 'plaintext';
    return fakeDocument(source, languageId, `file:///${name}`);
}

/** `Class(method,method),topLevel` - compact enough to assert on directly. */
function outline(nodes) {
    return nodes
        .map(node => (node.children.length ? `${node.name}(${outline(node.children)})` : node.name))
        .join(',');
}

function kindOf(node) {
    return mock.KIND_NAMES[node.kind];
}

module.exports = { mock, fakeDocument, loadFixture, outline, kindOf };
