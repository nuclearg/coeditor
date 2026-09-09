import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * E2E 配置：真实浏览器（puppeteer）+ 真实后端/mock AI/dev server。
 * 运行前需要浏览器：`pnpm exec puppeteer browsers install chrome-headless-shell`
 * （或设置 PUPPETEER_EXECUTABLE_PATH）。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@plugin-registry': path.resolve(__dirname, 'src/plugin/registry.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['e2e/**/*.test.ts'],
    globalSetup: ['./e2e/global-setup.ts'],
    // e2e 逐个文件串行执行：每文件各自启动浏览器，避免并发互相干扰
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 120_000,
    // 用例输出带序号，方便对照真实交互步骤
    reporters: ['default'],
  },
})
