module.exports = {
  preset: '@react-native/jest-preset',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@noble)/)',
  ],
  moduleNameMapper: {
    '^lucide-react-native$': '<rootDir>/jest/lucideMock.js',
  },
  testPathIgnorePatterns: ['/node_modules/', '/ios/', '/android/', '/__tests__/helpers.ts', '/__tests__/nodeSqlite.ts', '/__tests__/fakes.ts'],
};
