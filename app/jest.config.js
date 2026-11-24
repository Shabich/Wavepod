module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@noble)/)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/ios/', '/android/', '/__tests__/helpers.ts'],
};
