'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { loadFixture } = require('./harness');
const { parseFallback } = require('../../out/fallback');
const { link } = require('../../out/model');
const { toPlainNodes } = require('../../out/panel');
const {
    Kind, match, shape, findEnclosing, pathTo, countNodes, isFunctionKind
} = require('../../out/shape');

/** Builds a PlainNode tree without going through the parser. */
function node(name, kind, line, endLine, children = []) {
    return {
        id: `${name}@${line}`,
        name,
        detail: '',
        kind,
        kindName: '',
        line,
        endLine,
        character: 0,
        children
    };
}

const SAMPLE = [
    node('OrderService', Kind.Class, 0, 40, [
        node('constructor', Kind.Constructor, 1, 3),
        node('createOrder', Kind.Method, 4, 12),
        node('submitOrder', Kind.Method, 13, 25, [
            node('assertSubmittable', Kind.Function, 14, 18)
        ]),
        node('total', Kind.Method, 26, 32)
    ]),
    node('Order', Kind.Interface, 41, 46, [
        node('id', Kind.Property, 42, 42),
        node('customer', Kind.Property, 43, 43)
    ]),
    node('formatMoney', Kind.Function, 47, 52)
];

const NO_FILTER = { query: '', functionsOnly: false, sortOrder: 'position' };

function outline(nodes) {
    return nodes
        .map(n => (n.children.length ? `${n.name}(${outline(n.children)})` : n.name))
        .join(',');
}

describe('fuzzy match', () => {
    it('matches a plain substring', () => {
        assert.ok(match('createOrder', 'order'));
    });

    it('matches an acronym typed from the camel humps', () => {
        assert.ok(match('OrderService', 'os'));
        assert.ok(match('assertSubmittable', 'as'));
    });

    it('is case insensitive', () => {
        assert.ok(match('formatMoney', 'MONEY'));
    });

    it('rejects characters that are not there in order', () => {
        assert.equal(match('createOrder', 'zzz'), undefined);
        assert.equal(match('createOrder', 'redo'), undefined, 'out-of-order letters must not match');
    });

    it('returns every match for an empty query', () => {
        assert.deepEqual(match('anything', ''), { score: 0, indices: [] });
    });

    it('reports the matched positions so they can be highlighted', () => {
        assert.deepEqual(match('total', 'tot').indices, [0, 1, 2]);
    });

    it('scores a prefix above a match buried in the middle', () => {
        const prefix = match('orderTotal', 'order').score;
        const buried = match('reorderThings', 'order').score;
        assert.ok(prefix > buried, `${prefix} should beat ${buried}`);
    });

    it('scores an adjacent run above a scattered match', () => {
        const adjacent = match('submitOrder', 'sub').score;
        const scattered = match('setUpBar', 'sub').score;
        assert.ok(adjacent > scattered, `${adjacent} should beat ${scattered}`);
    });
});

describe('shape: search', () => {
    it('keeps ancestors so a nested hit stays reachable', () => {
        const { nodes } = shape(SAMPLE, { ...NO_FILTER, query: 'assert' });
        assert.equal(outline(nodes), 'OrderService(submitOrder(assertSubmittable))');
    });

    it('marks only genuine hits as matched, not the ancestors', () => {
        const { matched } = shape(SAMPLE, { ...NO_FILTER, query: 'assert' });
        assert.ok(matched.has('assertSubmittable@14'));
        assert.ok(!matched.has('OrderService@0'), 'the parent was kept, not matched');
    });

    it('records highlight positions for each hit', () => {
        const { highlights } = shape(SAMPLE, { ...NO_FILTER, query: 'total' });
        assert.deepEqual(highlights.get('total@26'), [0, 1, 2, 3, 4]);
    });

    it('ranks better matches first while searching', () => {
        const { nodes } = shape(SAMPLE, { ...NO_FILTER, query: 'order' });
        const names = nodes.map(n => n.name);
        assert.equal(names[0], 'Order', `expected the exact name first, got ${names.join(',')}`);
    });

    it('returns nothing when no name matches', () => {
        const { nodes } = shape(SAMPLE, { ...NO_FILTER, query: 'nonexistent' });
        assert.equal(nodes.length, 0);
    });

    it('leaves the tree untouched for an empty query', () => {
        const { nodes } = shape(SAMPLE, NO_FILTER);
        assert.equal(countNodes(nodes), countNodes(SAMPLE));
    });
});

describe('shape: functions only', () => {
    it('drops properties but keeps functions and their containers', () => {
        const { nodes } = shape(SAMPLE, { ...NO_FILTER, functionsOnly: true });
        assert.equal(
            outline(nodes),
            'OrderService(constructor,createOrder,submitOrder(assertSubmittable),total),formatMoney'
        );
    });

    it('drops a container left with nothing callable inside', () => {
        const { nodes } = shape(SAMPLE, { ...NO_FILTER, functionsOnly: true });
        assert.ok(!nodes.some(n => n.name === 'Order'), 'the property-only interface should be hidden');
    });

    it('agrees with isFunctionKind', () => {
        assert.ok(isFunctionKind(Kind.Method));
        assert.ok(isFunctionKind(Kind.Function));
        assert.ok(isFunctionKind(Kind.Constructor));
        assert.ok(!isFunctionKind(Kind.Property));
    });

    it('combines with a search query', () => {
        const { nodes } = shape(SAMPLE, { ...NO_FILTER, functionsOnly: true, query: 'id' });
        // Subsequence matching means "id" still reaches submitOrder (subm-i-tOr-d-er),
        // exactly as VS Code's own quick open behaves. What must not come back is
        // the Property literally named `id`, which functions-only mode excludes.
        const names = [];
        const collect = list => list.forEach(n => { names.push(n.name); collect(n.children); });
        collect(nodes);
        assert.ok(!names.includes('id'), `the id property leaked through: ${names.join(',')}`);
    });
});

describe('shape: sorting', () => {
    it('keeps file order by default', () => {
        const { nodes } = shape(SAMPLE, NO_FILTER);
        assert.deepEqual(nodes.map(n => n.name), ['OrderService', 'Order', 'formatMoney']);
    });

    it('sorts by name at every level when asked', () => {
        const { nodes } = shape(SAMPLE, { ...NO_FILTER, sortOrder: 'name' });
        assert.deepEqual(nodes.map(n => n.name), ['formatMoney', 'Order', 'OrderService']);
        assert.deepEqual(
            nodes[2].children.map(n => n.name),
            ['constructor', 'createOrder', 'submitOrder', 'total']
        );
    });

    it('ranks by match quality instead of name while searching', () => {
        const { nodes } = shape(SAMPLE, { ...NO_FILTER, sortOrder: 'name', query: 'order' });
        assert.equal(nodes[0].name, 'Order');
    });
});

describe('cursor mapping', () => {
    it('finds the innermost symbol containing a line', () => {
        assert.equal(findEnclosing(SAMPLE, 15).name, 'assertSubmittable');
        assert.equal(findEnclosing(SAMPLE, 27).name, 'total');
        assert.equal(findEnclosing(SAMPLE, 0).name, 'OrderService');
    });

    it('returns nothing for a line outside every symbol', () => {
        assert.equal(findEnclosing(SAMPLE, 60), undefined);
    });

    it('builds a breadcrumb path for a node', () => {
        assert.equal(pathTo(SAMPLE, 'assertSubmittable@14'), 'OrderService > submitOrder > assertSubmittable');
    });

    it('returns an empty path for an unknown id', () => {
        assert.equal(pathTo(SAMPLE, 'missing'), '');
    });
});

describe('conversion from parsed symbols', () => {
    it('turns the parser output into plain serialisable nodes', () => {
        const document = loadFixture('sample.py');
        const roots = parseFallback(document);
        link(roots);
        const plain = toPlainNodes(roots);

        assert.equal(outline(plain), 'load,Repository(__init__,save(_validate),find),main');
        const repository = plain[1];
        assert.equal(typeof repository.line, 'number');
        assert.equal(typeof repository.endLine, 'number');
        assert.ok(repository.endLine > repository.line);
        // Must survive a round trip through postMessage.
        assert.deepEqual(JSON.parse(JSON.stringify(plain)), plain);
    });

    it('search works end to end on real parsed output', () => {
        const document = loadFixture('sample.py');
        const roots = parseFallback(document);
        link(roots);
        const { nodes } = shape(toPlainNodes(roots), { ...NO_FILTER, query: 'val' });
        assert.equal(outline(nodes), 'Repository(save(_validate))');
    });
});
