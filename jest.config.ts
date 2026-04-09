import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.spec.ts'],
  moduleNameMapper: {
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@db/(.*)$': '<rootDir>/src/db/$1',
    '^@redis/(.*)$': '<rootDir>/src/redis/$1',
    '^@agent/(.*)$': '<rootDir>/src/agent/$1',
    '^@llm/(.*)$': '<rootDir>/src/llm/$1',
    '^@ocr/(.*)$': '<rootDir>/src/ocr/$1',
    '^@admin/(.*)$': '<rootDir>/src/admin/$1',
    '^@orders/(.*)$': '<rootDir>/src/orders/$1',
    '^@menu/(.*)$': '<rootDir>/src/menu/$1',
    '^@workers/(.*)$': '<rootDir>/src/workers/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
  },
  setupFiles: ['<rootDir>/jest.env.js'],
  forceExit: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};

export default config;
