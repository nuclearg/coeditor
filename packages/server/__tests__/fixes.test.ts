import { describe, it, expect } from 'vitest'
import type { AiConversation, AiAnswer, AiTurn } from '@coeditor/shared'
import { generateId } from '@coeditor/shared'
import { setupTestEnv, createRpcHelpers } from './helpers'
import app from '../src/index'
import { repo } from '../src/store/index'
import { USER_ID } from '../src/lib/utils'

setupTestEnv()

const { rpcOk, rpcFail } = createRpcHelpers(app)

describe('Conversation type partitioning', () => {
  const docId = 'doc_partition_1'
  let ch1Id: string
  let ch2Id: string

  it('setup — create doc with two chapters', async () => {
    await rpcOk('documents.create', { id: docId, title: '分区测试' })
    const ch1 = await rpcOk<{ id: string }>('chapters.create', { docId, title: '章1' })
    const ch2 = await rpcOk<{ id: string }>('chapters.create', { docId, title: '章2' })
    ch1Id = ch1.id
    ch2Id = ch2.id
  })

  it('casual and chapter_review conversations do not cross-match', async () => {
    const casual = await rpcOk<AiConversation>('conversations.create', {
      docId, type: 'casual', parentId: docId,
    })
    const chapter = await rpcOk<AiConversation>('conversations.create', {
      docId, type: 'chapter_review', parentId: ch1Id,
    })

    const casualList = await rpcOk<AiConversation[]>('conversations.list', {
      docId, parentId: docId, type: 'casual',
    })
    const chapterList = await rpcOk<AiConversation[]>('conversations.list', {
      docId, parentId: ch1Id, type: 'chapter_review',
    })

    expect(casualList.some((c) => c.id === casual.id)).toBe(true)
    expect(casualList.some((c) => c.id === chapter.id)).toBe(false)
    expect(chapterList.some((c) => c.id === chapter.id)).toBe(true)
    expect(casualList.some((c) => c.id === casual.id)).toBe(true)
    expect(chapterList.some((c) => c.id === casual.id)).toBe(false)
  })

  it('chapter_review conversations are scoped per chapter', async () => {
    await rpcOk('conversations.create', { docId, type: 'chapter_review', parentId: ch1Id })
    await rpcOk('conversations.create', { docId, type: 'chapter_review', parentId: ch2Id })

    const ch1List = await rpcOk<AiConversation[]>('conversations.list', {
      docId, parentId: ch1Id, type: 'chapter_review',
    })
    const ch2List = await rpcOk<AiConversation[]>('conversations.list', {
      docId, parentId: ch2Id, type: 'chapter_review',
    })

    // Each chapter only sees its own conversations
    expect(ch1List.every((c) => c.chapterId === ch1Id)).toBe(true)
    expect(ch2List.every((c) => c.chapterId === ch2Id)).toBe(true)
    expect(ch1List.some((c) => c.chapterId === ch2Id)).toBe(false)
  })
})

describe('Paragraph conversation partitioning', () => {
  const docId = 'doc_para_partition'
  let p1Id: string
  let p2Id: string

  it('setup — create doc, chapter and two paragraphs', async () => {
    await rpcOk('documents.create', { id: docId, title: '段落分区测试' })
    const ch = await rpcOk<{ id: string }>('chapters.create', { docId, title: '章1' })
    const p1 = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId: ch.id, name: '段1' })
    const p2 = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId: ch.id, name: '段2' })
    p1Id = p1.id
    p2Id = p2.id
  })

  it('paragraph_review conversations are scoped per paragraph', async () => {
    const p1Conv = await rpcOk<AiConversation>('conversations.create', {
      docId, type: 'paragraph_review', parentId: p1Id,
    })
    const p2Conv = await rpcOk<AiConversation>('conversations.create', {
      docId, type: 'paragraph_review', parentId: p2Id,
    })

    // The parent paragraph id is stored on the conversation
    expect(p1Conv.paragraphId).toBe(p1Id)
    expect(p2Conv.paragraphId).toBe(p2Id)

    const p1List = await rpcOk<AiConversation[]>('conversations.list', {
      docId, parentId: p1Id, type: 'paragraph_review',
    })
    const p2List = await rpcOk<AiConversation[]>('conversations.list', {
      docId, parentId: p2Id, type: 'paragraph_review',
    })

    expect(p1List.some((c) => c.id === p1Conv.id)).toBe(true)
    expect(p1List.some((c) => c.id === p2Conv.id)).toBe(false)
    expect(p2List.some((c) => c.id === p2Conv.id)).toBe(true)
    expect(p2List.some((c) => c.id === p1Conv.id)).toBe(false)
  })
})

describe('Attachment conversation partitioning (regression)', () => {
  const docId = 'doc_att_partition'

  it('setup — create doc and two attachments', async () => {
    await rpcOk('documents.create', { id: docId, title: '附件分区测试', templateId: 'novel' })
    await rpcOk('attachments.ensure', { docId, type: 'outline' })
    await rpcOk('attachments.ensure', { docId, type: 'worldview' })
  })

  it('attachment_review conversations are scoped per attachment type', async () => {
    const outlineConv = await rpcOk<AiConversation>('conversations.create', {
      docId, type: 'attachment_review', parentId: 'outline',
    })
    const worldviewConv = await rpcOk<AiConversation>('conversations.create', {
      docId, type: 'attachment_review', parentId: 'worldview',
    })

    expect(outlineConv.attachmentId).toBe('outline')
    expect(worldviewConv.attachmentId).toBe('worldview')

    const outlineList = await rpcOk<AiConversation[]>('conversations.list', {
      docId, parentId: 'outline', type: 'attachment_review',
    })
    const worldviewList = await rpcOk<AiConversation[]>('conversations.list', {
      docId, parentId: 'worldview', type: 'attachment_review',
    })

    expect(outlineList.some((c) => c.id === outlineConv.id)).toBe(true)
    expect(outlineList.some((c) => c.id === worldviewConv.id)).toBe(false)
    expect(worldviewList.some((c) => c.id === worldviewConv.id)).toBe(true)
    expect(worldviewList.some((c) => c.id === outlineConv.id)).toBe(false)
  })

  it('casual and attachment_review conversations do not cross-match', async () => {
    const casual = await rpcOk<AiConversation>('conversations.create', {
      docId, type: 'casual', parentId: docId,
    })
    const attachment = await rpcOk<AiConversation>('conversations.create', {
      docId, type: 'attachment_review', parentId: 'outline',
    })

    const casualList = await rpcOk<AiConversation[]>('conversations.list', {
      docId, parentId: docId, type: 'casual',
    })
    const attList = await rpcOk<AiConversation[]>('conversations.list', {
      docId, parentId: 'outline', type: 'attachment_review',
    })

    expect(casualList.some((c) => c.id === casual.id)).toBe(true)
    expect(casualList.some((c) => c.id === attachment.id)).toBe(false)
    expect(attList.some((c) => c.id === attachment.id)).toBe(true)
    expect(attList.some((c) => c.id === casual.id)).toBe(false)
  })
})

describe('Reorder duplicate-ID validation', () => {
  const docId = 'doc_dup_test'
  let ch1Id: string
  let ch2Id: string

  it('setup — create doc with two chapters and two paragraphs', async () => {
    await rpcOk('documents.create', { id: docId, title: '去重测试' })
    const ch1 = await rpcOk<{ id: string }>('chapters.create', { docId, title: '章A' })
    const ch2 = await rpcOk<{ id: string }>('chapters.create', { docId, title: '章B' })
    ch1Id = ch1.id
    ch2Id = ch2.id
  })

  it('documents.reorderChapters — rejects duplicate IDs', async () => {
    const err = await rpcFail('documents.reorderChapters', { docId, chapterOrder: [ch1Id, ch1Id] })
    expect(err).toContain('重复')
  })

  it('paragraphs.reorder — rejects duplicate IDs', async () => {
    const p1 = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId: ch1Id, name: 'p1' })
    const p2 = await rpcOk<{ id: string }>('paragraphs.create', { docId, chapterId: ch1Id, name: 'p2' })
    const err = await rpcFail('paragraphs.reorder', { docId, chapterId: ch1Id, paragraphOrder: [p1.id, p1.id] })
    expect(err).toContain('重复')
    // Original order intact
    const paras = await rpcOk<Array<{ id: string }>>('paragraphs.list', { docId, chapterId: ch1Id })
    expect(paras.map((p) => p.id)).toEqual([p1.id, p2.id])
  })

  it('chapterOrder stays valid after a rejected duplicate reorder', async () => {
    await rpcOk('documents.reorderChapters', { docId, chapterOrder: [ch2Id, ch1Id] })
    const chs = await rpcOk<Array<{ id: string }>>('chapters.list', { docId })
    expect(chs.map((c) => c.id)).toEqual([ch2Id, ch1Id])
  })
})

// turns.retry endpoint was removed (client never called it; retries go
// through ai.chat streaming). The semantics it exposed live one layer down
// in repo.turns.addAnswer — covered here at store level.
describe('turns.addAnswer (store-level; replaces removed turns.retry)', () => {
  const docId = 'doc_retry_test'
  let convId: string

  const makeAnswer = (id: string, content: string, thinking = '', model = 'test-model'): AiAnswer => ({
    id, content, thinking, model, timeCreated: new Date().toISOString(),
  })

  it('setup — create doc and conversation', async () => {
    await rpcOk('documents.create', { id: docId, title: '回填测试' })
    const conv = await rpcOk<AiConversation>('conversations.create', {
      docId, type: 'paragraph_review', parentId: 'para_x',
    })
    convId = conv.id
  })

  it('turns.create — no placeholder answer anymore', async () => {
    const turn = await rpcOk<AiTurn>('turns.create', {
      docId, convId, question: '占位测试',
    })
    expect(turn.answers.length).toBe(0)
  })

  it('push without answerId adds a new answer and makes it current', async () => {
    const turn = await rpcOk<AiTurn>('turns.create', {
      docId, convId, question: '追加测试',
    })
    await repo.turns.addAnswer(USER_ID, docId, convId, turn.id, makeAnswer(generateId(), '新候选答案'))
    const after = await rpcOk<AiTurn>('turns.get', { docId, turnId: turn.id, convId })
    expect(after.answers.length).toBe(1)
    expect(after.currentAnswerIndex).toBe(0)
  })

  it('unknown existingAnswerId falls back to pushing a new answer', async () => {
    const turn = await rpcOk<AiTurn>('turns.create', {
      docId, convId, question: '未知ID测试',
    })
    await repo.turns.addAnswer(USER_ID, docId, convId, turn.id, makeAnswer(generateId(), '兜底答案'), 'no_such_answer')
    const after = await rpcOk<AiTurn>('turns.get', { docId, turnId: turn.id, convId })
    expect(after.answers.length).toBe(1)
  })

  // T2: the in-place update branch is what ai.chat's throttled writes rely
  // on (one bubble per stream, not one per persist).
  it('same answerId twice updates in place — one answer, content replaced, index untouched', async () => {
    const turn = await rpcOk<AiTurn>('turns.create', {
      docId, convId, question: '原地更新测试',
    })
    const answerId = generateId()
    // First call: answerId not found yet → pushes (index 0)
    await repo.turns.addAnswer(USER_ID, docId, convId, turn.id, makeAnswer(answerId, 'v1', 'thinking-v1'), answerId)
    // Second call: same answerId → in-place update, no new bubble
    await repo.turns.addAnswer(USER_ID, docId, convId, turn.id, makeAnswer(answerId, 'v2'), answerId)

    const after = await repo.turns.get(USER_ID, docId, convId, turn.id)
    expect(after).not.toBeNull()
    expect(after!.answers.length).toBe(1)
    expect(after!.answers[0].content).toBe('v2')
    expect(after!.currentAnswerIndex).toBe(0)
  })

  it('empty content/thinking in an update keeps the previous values (merge semantics)', async () => {
    const turn = await rpcOk<AiTurn>('turns.create', {
      docId, convId, question: '合并语义测试',
    })
    const answerId = generateId()
    await repo.turns.addAnswer(USER_ID, docId, convId, turn.id, makeAnswer(answerId, '原内容', '原思考'), answerId)
    // Empty strings must NOT clobber the stored content/thinking
    await repo.turns.addAnswer(USER_ID, docId, convId, turn.id, makeAnswer(answerId, '', ''), answerId)

    const after = await repo.turns.get(USER_ID, docId, convId, turn.id)
    expect(after!.answers[0].content).toBe('原内容')
    expect(after!.answers[0].thinking).toBe('原思考')
  })

  // B18: cancelled-stream drains push with makeCurrent=false so a late
  // partial answer cannot steal the selected-answer slot.
  it('makeCurrent=false push does not move currentAnswerIndex', async () => {
    const turn = await rpcOk<AiTurn>('turns.create', {
      docId, convId, question: 'makeCurrent测试',
    })
    await repo.turns.addAnswer(USER_ID, docId, convId, turn.id, makeAnswer(generateId(), '正式答案'))
    await repo.turns.addAnswer(USER_ID, docId, convId, turn.id, makeAnswer(generateId(), '被取消的半截答案'), undefined, false)

    const after = await repo.turns.get(USER_ID, docId, convId, turn.id)
    expect(after!.answers.length).toBe(2)
    expect(after!.currentAnswerIndex).toBe(0)
    expect(after!.answers[0].content).toBe('正式答案')
  })
})

describe('settings.update style validation', () => {
  it('rejects an invalid style value', async () => {
    const err = await rpcFail('settings.update', { style: 'not-a-style' })
    expect(err).toBeTruthy()
  })

  it('accepts all three valid styles', async () => {
    for (const style of ['gentle', 'strict', 'praise']) {
      const s = await rpcOk<{ style: string }>('settings.update', { style })
      expect(s.style).toBe(style)
    }
  })
})

describe('path traversal protection (templates)', () => {
  it('templates.get rejects path traversal ids', async () => {
    const err = await rpcFail('templates.get', { templateId: '../../users/default_user/config' })
    expect(err).toContain('非法字符')
  })

  it('templates.get rejects absolute path ids', async () => {
    const err = await rpcFail('templates.get', { templateId: '/etc/passwd' })
    expect(err).toContain('非法字符')
  })

  it('documents.create rejects a traversal templateId', async () => {
    const err = await rpcFail('documents.create', { title: 'x', templateId: '../config' })
    expect(err).toContain('非法字符')
  })

  it('templates.get still resolves a valid template', async () => {
    const t = await rpcOk<{ id: string }>('templates.get', { templateId: 'novel' })
    expect(t.id).toBe('novel')
  })
})
