import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'out/**',
            'dist/**',
            'node_modules/**',
            '.vscode-test/**',
            '.venv/**',
            '*.vsix',
            // Deliberately odd source used as parser input, not as project code.
            'test/fixtures/**'
        ]
    },

    // Extension and test sources: full type-aware linting.
    {
        files: ['src/**/*.ts'],
        extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname
            }
        },
        rules: {
            // TypeScript resolves globals itself; no-undef only produces noise.
            'no-undef': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            // The VS Code API hands back plenty of thenables that are
            // deliberately not awaited; `void` marks those, and this allows it.
            '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
            '@typescript-eslint/no-non-null-assertion': 'off',
            curly: 'error',
            eqeqeq: ['error', 'always'],
            'no-throw-literal': 'error',
            'prefer-const': 'error',
            semi: 'error',
            'no-console': 'error'
        }
    },

    // Build scripts and unit tests: plain Node, no type information.
    {
        files: ['esbuild.js', 'test/**/*.js', '*.mjs'],
        extends: [js.configs.recommended],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'writable',
                exports: 'writable',
                process: 'readonly',
                console: 'readonly',
                __dirname: 'readonly',
                setTimeout: 'readonly'
            }
        },
        rules: {
            curly: 'error',
            eqeqeq: ['error', 'always'],
            'prefer-const': 'error',
            semi: 'error'
        }
    },
    {
        files: ['*.mjs'],
        languageOptions: { sourceType: 'module' }
    }
);
