import { Hono } from 'hono'
import { z } from 'zod/v4'
import { defineRpc, safeId } from '../lib/rpc.js'
import { repo } from '../store/index.js'

const app = new Hono()

app.post('/api/templates.list', defineRpc(
  z.object({}),
  async () => {
    return repo.templates.list()
  },
))

app.post('/api/templates.get', defineRpc(
  z.object({ templateId: safeId }),
  async (input) => {
    const template = await repo.templates.get(input.templateId)
    if (!template) throw new Error('模板不存在')
    return template
  },
))

export default app
