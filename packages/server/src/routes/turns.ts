import { Hono } from 'hono'
import { z } from 'zod/v4'
import { generateId } from '@coeditor/shared'
import { defineRpc, safeId, safeTurnId } from '../lib/rpc.js'
import { USER_ID } from '../lib/utils.js'
import { repo } from '../store/index.js'

const app = new Hono()

app.post('/api/turns.list', defineRpc(
  z.object({ docId: safeId, convId: safeId }),
  async (input) => {
    return repo.turns.list(USER_ID, input.docId, input.convId)
  },
))

app.post('/api/turns.create', defineRpc(
  z.object({
    docId: safeId,
    convId: safeId,
    question: z.string().max(100000),
    questionVisible: z.boolean().optional(),
  }),
  async (input) => {
    // Parent conversation must exist — otherwise we write an orphan turn
    // file that no conversation-scoped list can ever surface.
    const conv = await repo.conversations.get(USER_ID, input.docId, input.convId)
    if (!conv) throw new Error('会话不存在')

    const existingTurns = await repo.turns.list(USER_ID, input.docId, input.convId)

    const turnId = generateId()

    return repo.turns.create(USER_ID, input.docId, input.convId, {
      id: turnId,
      conversationId: input.convId,
      // max+1 keeps ordering stable even if turns were deleted before
      order: existingTurns.reduce((max, t) => Math.max(max, t.order), 0) + 1,
      question: {
        content: input.question,
        questionVisible: input.questionVisible ?? true,
        createdAt: new Date().toISOString(),
      },
      // No placeholder answer — the backend persists the real answer as it
      // streams (see ai.chat), so a turn starts with zero answers.
      answers: [],
      currentAnswerIndex: 0,
      timeCreated: new Date().toISOString(),
    })
  },
))

app.post('/api/turns.get', defineRpc(
  z.object({ docId: safeId, turnId: safeTurnId, convId: safeId.optional() }),
  async (input) => {
    if (input.convId) {
      const turn = await repo.turns.get(USER_ID, input.docId, input.convId, input.turnId)
      if (turn) return turn
    }
    const turn = await repo.turns.findById(USER_ID, input.docId, input.turnId)
    if (!turn) throw new Error('Turn 不存在')
    return turn
  },
))

app.post('/api/turns.delete', defineRpc(
  z.object({ docId: safeId, turnId: safeTurnId, convId: safeId.optional() }),
  async (input) => {
    if (input.convId) {
      await repo.turns.delete(USER_ID, input.docId, input.convId, input.turnId)
      return null
    }
    const turn = await repo.turns.findById(USER_ID, input.docId, input.turnId)
    if (!turn) throw new Error('Turn 不存在')
    await repo.turns.delete(USER_ID, input.docId, turn.conversationId, input.turnId)
    return null
  },
))

app.post('/api/turns.selectAnswer', defineRpc(
  z.object({
    docId: safeId,
    turnId: safeTurnId,
    convId: safeId.optional(),
    answerIndex: z.number().int().min(0),
  }),
  async (input) => {
    let convId = input.convId
    if (!convId) {
      const turn = await repo.turns.findById(USER_ID, input.docId, input.turnId)
      if (!turn) throw new Error('Turn 不存在')
      convId = turn.conversationId
    }

    return repo.turns.updateAnswerIndex(USER_ID, input.docId, convId, input.turnId, input.answerIndex)
  },
))

export default app
