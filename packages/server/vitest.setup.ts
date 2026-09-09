/**
 * Vitest setup file (runs before each test file's imports).
 *
 * COEDITOR_DATA_DIR must be set BEFORE any test imports app modules:
 * DATA_ROOT is resolved once at module-load time in store/file-paths.ts.
 * Setting it here (via setupFiles) replaces the old import-order trick in
 * __tests__/helpers.ts — nothing can import the app before this runs.
 */
import path from 'node:path'
import { tmpdir } from 'node:os'

// Unique per worker process — prevents parallel test files colliding.
const TEST_DIR = path.join(tmpdir(), `coeditor-test-${process.pid}-${Date.now()}`)

process.env.COEDITOR_DATA_DIR = TEST_DIR
process.env.NODE_ENV = 'test'
