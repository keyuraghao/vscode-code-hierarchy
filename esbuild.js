const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Reports build failures with file/line so watch mode is usable. */
function problemReporter(label) {
    return {
        name: 'problem-reporter',
        setup(build) {
            build.onEnd(result => {
                for (const error of result.errors) {
                    const where = error.location
                        ? `${error.location.file}:${error.location.line}:${error.location.column}`
                        : 'unknown location';
                    console.error(`✘ [${label}] ${error.text}  [${where}]`);
                }
                if (!result.errors.length) {
                    console.log(`${label} build finished${production ? ' (production)' : ''}`);
                }
            });
        }
    };
}

/**
 * The webview renders VS Code's own codicon glyphs, so the font and its
 * stylesheet have to sit inside dist/ where the webview's localResourceRoots
 * can reach them.
 */
function copyCodicons() {
    const from = path.join('node_modules', '@vscode', 'codicons', 'dist');
    for (const file of ['codicon.css', 'codicon.ttf']) {
        fs.copyFileSync(path.join(from, file), path.join('dist', file));
    }
    console.log('codicons copied');
}

const shared = {
    bundle: true,
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    logLevel: 'silent'
};

async function main() {
    // A stale artifact from an earlier build must never reach the package.
    fs.rmSync('dist', { recursive: true, force: true });
    fs.mkdirSync('dist', { recursive: true });

    const contexts = await Promise.all([
        esbuild.context({
            ...shared,
            entryPoints: ['src/extension.ts'],
            outfile: 'dist/extension.js',
            format: 'cjs',
            platform: 'node',
            target: 'node18',
            // Supplied by the extension host at runtime, never bundled.
            external: ['vscode'],
            plugins: [problemReporter('extension')]
        }),
        esbuild.context({
            ...shared,
            entryPoints: ['src/webview/main.ts'],
            outfile: 'dist/webview.js',
            format: 'iife',
            platform: 'browser',
            target: 'es2020',
            plugins: [problemReporter('webview')]
        })
    ]);

    copyCodicons();

    if (watch) {
        await Promise.all(contexts.map(context => context.watch()));
    } else {
        await Promise.all(contexts.map(context => context.rebuild()));
        await Promise.all(contexts.map(context => context.dispose()));
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
