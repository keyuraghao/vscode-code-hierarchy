import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    label: 'integration',
    files: 'out/test/integration/**/*.test.js',
    // Fixtures double as the test workspace so the built-in TypeScript server
    // has something real to answer about.
    workspaceFolder: './test/fixtures',
    version: 'stable',
    mocha: {
        ui: 'tdd',
        timeout: 60_000,
        color: true
    },
    launchArgs: [
        '--disable-gpu'
    ]
});
