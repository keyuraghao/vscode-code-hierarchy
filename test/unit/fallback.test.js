'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { mock, fakeDocument, loadFixture, outline, kindOf } = require('./harness');
const { parseFallback } = require('../../out/fallback');
const { link, findEnclosing, qualifiedPath } = require('../../out/model');

/** Parse a fixture and wire up parents/ids the way the extension does. */
function parse(name) {
    const document = loadFixture(name);
    const roots = parseFallback(document);
    const count = link(roots);
    return { roots, count, document };
}

describe('fallback parser: Python', () => {
    const { roots } = parse('sample.py');

    it('nests methods under their class and closures under their function', () => {
        assert.equal(outline(roots), 'load,Repository(__init__,save(_validate),find),main');
    });

    it('marks methods of a class as methods', () => {
        assert.equal(kindOf(roots[1].children[0]), 'Method');
        assert.equal(kindOf(roots[1]), 'Class');
    });

    it('ignores "def" and "class" appearing inside docstrings', () => {
        assert.equal(roots[0].children.length, 0, 'load() should have no children');
    });

    it('does not let a class range swallow the module-level code after it', () => {
        const repository = roots[1];
        const main = roots[2];
        assert.ok(repository.range.end.line < main.range.start.line);
    });

    it('keeps a multi-line call from ending the enclosing method early', () => {
        const save = roots[1].children[1];
        assert.ok(save.range.end.line >= 29, `save ended at line ${save.range.end.line + 1}`);
    });

    it('maps a cursor position to the innermost enclosing symbol', () => {
        const node = findEnclosing(roots, new mock.Position(24, 8));
        assert.equal(qualifiedPath(node), 'Repository > save');
    });
});

describe('fallback parser: TypeScript', () => {
    const { roots } = parse('sample.ts');

    it('finds class members, arrow constants and plain functions', () => {
        assert.equal(outline(roots), 'Store(constructor,add,remove),createStore,formatLabel');
    });

    it('recognises the constructor as a constructor', () => {
        assert.equal(kindOf(roots[0].children[0]), 'Constructor');
        assert.equal(kindOf(roots[0].children[1]), 'Method');
    });

    it('does not mistake if/for/while blocks for declarations', () => {
        const names = roots[0].children.map(node => node.name);
        for (const keyword of ['if', 'for', 'while']) {
            assert.ok(!names.includes(keyword), `"${keyword}" was treated as a symbol`);
        }
    });
});

describe('fallback parser: Go', () => {
    const { roots } = parse('sample.go');

    it('reads `type X struct` and skips the package clause', () => {
        assert.equal(outline(roots), 'Server,NewServer,Start,handle');
        assert.equal(kindOf(roots[0]), 'Struct');
    });

    it('treats a receiver function as a method and shows the receiver', () => {
        assert.equal(kindOf(roots[2]), 'Method');
        assert.equal(roots[2].detail, '(*Server)');
    });
});

describe('fallback parser: Rust', () => {
    const { roots } = parse('sample.rs');

    it('lists the struct, its impl block and free functions', () => {
        assert.equal(outline(roots), 'Config,Config(new,merge),main');
    });

    it('does not treat a lifetime as an unterminated string', () => {
        const merge = roots[1].children[1];
        assert.equal(merge.name, 'merge');
    });
});

describe('fallback parser: Java', () => {
    const { roots } = parse('Sample.java');

    it('nests members under the class and spots the constructor', () => {
        assert.equal(outline(roots), 'Sample(Sample,main,total)');
        assert.equal(kindOf(roots[0].children[0]), 'Constructor');
    });
});

describe('fallback parser: C with the brace on the next line', () => {
    const { roots } = parse('allman.c');

    it('still finds the functions', () => {
        assert.equal(outline(roots), 'add,main');
    });

    it('calls top-level functions functions, not methods', () => {
        assert.equal(kindOf(roots[0]), 'Function');
    });
});

describe('fallback parser: edge cases', () => {
    it('returns nothing for an empty document', () => {
        assert.equal(parseFallback(fakeDocument('', 'typescript')).length, 0);
    });

    it('returns nothing for prose', () => {
        const document = fakeDocument('Just some words.\nAnd another line.', 'plaintext');
        assert.equal(parseFallback(document).length, 0);
    });

    it('does not treat a function call statement as a declaration', () => {
        const document = fakeDocument('doWork(1, 2);\nconsole.log("x");\n', 'javascript');
        assert.equal(parseFallback(document).length, 0);
    });

    it('survives unbalanced braces without throwing or hanging', () => {
        const document = fakeDocument('function broken() {\n  if (x) {\n', 'javascript');
        const roots = parseFallback(document);
        assert.equal(outline(roots), 'broken');
    });

    it('clamps ranges to the end of the document', () => {
        const document = fakeDocument('def only():\n    pass', 'python');
        const roots = parseFallback(document);
        assert.equal(roots[0].range.end.line, document.lineCount - 1);
    });

    it('marks everything it produces as approximate', () => {
        const { roots } = parse('sample.py');
        const check = nodes => nodes.every(n => n.approximate === true && check(n.children));
        assert.ok(check(roots));
    });
});
