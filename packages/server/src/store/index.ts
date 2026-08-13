/**
 * Store entry point.
 *
 * Exports the `repo` singleton — the single point of access for all data operations.
 * Routes import only `repo` and never depend on the underlying storage mechanism.
 *
 * To switch from file-based storage to a database:
 * 1. Create a new class implementing Repository (e.g., DbRepository)
 * 2. Change the line below to: `export const repo = new DbRepository()`
 */

import { FileRepository } from './file-repository.js'
import type { Repository } from './types.js'

// Repository already includes loadPrompt — no intersection type needed.
export const repo: Repository = new FileRepository()

export type { Repository } from './types.js'
