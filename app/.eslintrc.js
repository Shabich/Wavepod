module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['src/radio/meshtastic/proto/**'],
  rules: {
    // Binary protocol and crypto code relies on bitwise operations.
    'no-bitwise': 'off',
    'no-void': ['error', { allowAsStatement: true }],
  },
};
