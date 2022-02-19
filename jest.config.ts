import type { Config } from '@jest/types';
import * as path from 'path';

// Alias aether path for convenience.
/* eslint-disable-next-line @typescript-eslint/no-var-requires */
require('dotenv').config({ path: path.join(__dirname, '.env') });
process.env.APP_STATIC = path.join(__dirname, 'tmp');

// Sync object
const config: Config.InitialOptions = {
  displayName: '@universe/campaign Unit Tests',
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['dotenv/config'],
  moduleFileExtensions: [
    'ts',
    'tsx',
    'js',
  ],
  transform: {
    '^.+\\.(ts|js|html)$': 'ts-jest',
  },
  testMatch: [
    '**/?(*.)+(spec|test).+(ts|tsx|js)',
  ],
  transformIgnorePatterns: [
    '/node_modules/',
  ],
  testPathIgnorePatterns: [
    '/esm/',
    '/dist/',
    '/bundle/',
    '/fixtures/',
  ],
};

export default config;
