import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/', 'dist/', 'coverage/'] },
  js.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  {
    files: ['**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      // Só as regras clássicas. As regras novas (refs/purity/set-state-in-effect) são para quem usa o
      // React Compiler; useCountdown lê Date.now() no render de propósito (é um relógio).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react/prop-types': 'off', // sem TypeScript/PropTypes neste projeto
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['test/**/*.{js,jsx}', 'vite.config.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.vitest } },
  },
  prettier,
];
