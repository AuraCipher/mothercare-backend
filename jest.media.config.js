/**
 * Dedicated jest config for tests that must exercise the REAL sharp +
 * file-type + uuid modules. The main config maps all three to deterministic
 * mocks (required by the rest of the suite); these tests prove actual media
 * decoding/resizing, so they run separately via:
 *
 *   npm run test:media-real
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests/modules/media'],
  testMatch: ['**/*.realsharp.test.ts'],
  setupFiles: ['./tests/setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },
  // Only file-type/uuid need bridges (ESM-only upstream); sharp stays real.
  moduleNameMapper: {
    '^file-type$': '<rootDir>/tests/__mocks__/file-type.real.ts',
    '^uuid$': '<rootDir>/tests/__mocks__/uuid.real.ts',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  verbose: true,
};
