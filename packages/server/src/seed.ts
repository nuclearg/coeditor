/**
 * 内置种子数据：保证任何全新数据目录都能开箱即用（内置文档模板）。
 *
 * 资源文件位于本包 resources/ 下（类似 Java 工程的 src/main/resources），
 * 构建时（esbuild / bun --compile）直接内联进 bundle，运行时无外部依赖。
 * 新增模板时：把 JSON 放进 resources/templates/ 并在下面加一行 import。
 *
 * 审阅 prompt 已全部内置于模板（顶层 prompts + 附件级 prompts），
 * 不再有独立的全局 prompts 目录。
 *
 * 种子只在数据目录缺少对应文件时写入（见 FileRepository.initialize），
 * 不会覆盖用户已有的模板。
 */
import novelTemplate from '../resources/templates/novel.json'
import essayTemplate from '../resources/templates/essay.json'
import type { DocumentTemplate } from '@coeditor/shared'

export const SEED_TEMPLATES: Record<string, DocumentTemplate> = {
  novel: novelTemplate as DocumentTemplate,
  essay: essayTemplate as DocumentTemplate,
}
