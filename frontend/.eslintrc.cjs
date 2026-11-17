module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  extends: ['eslint:recommended', 'plugin:react/recommended'],
  settings: { react: { version: '18.2' } },
  ignorePatterns: ['dist', 'node_modules', 'public', 'scripts', 'playwright-report', 'test-results', 'e2e', 'tests', '*.config.js'],
  rules: {
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
  },
};
