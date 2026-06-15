import type { Config } from 'jest';

const config: Config = {
  // Use ts-jest for TypeScript transformation
  preset: 'ts-jest',

  // Node environment (not jsdom)
  testEnvironment: 'node',

  // Look for test files in the tests/ directory
  roots: ['<rootDir>/tests/'],

  // Match test files with .test.ts extension
  testMatch: ['**/*.test.ts'],

  // Setup file runs before each test suite (sets env vars)
  setupFiles: ['./tests/setup.ts'],

  // Transform TypeScript files with ts-jest (using test tsconfig)
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tests/tsconfig.json' }],
  },

  // Ignore node_modules and dist
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/server.ts',
  ],

  // Reporters: default + jest-junit output to tests/results
  reporters: [
    'default',
    ['jest-junit', { outputDirectory: 'tests/results' }],
  ],

  // Mock native modules that can't compile in test environment
  moduleNameMapper: {
    '^sharp$': '<rootDir>/tests/__mocks__/sharp.ts',
    '^file-type$': '<rootDir>/tests/__mocks__/file-type.ts',
    '^multer$': '<rootDir>/tests/__mocks__/multer.ts',
    '^uuid$': '<rootDir>/tests/__mocks__/uuid.ts',
  },

  // Clear mocks between tests automatically
  clearMocks: true,

  // Show verbose output for debugging
  verbose: true,
};

export default config;
