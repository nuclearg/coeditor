/**
 * Puppeteer 启动辅助：优先用 puppeteer 自带的浏览器；找不到时尝试
 * PUPPETEER_EXECUTABLE_PATH 与 ~/.cache/puppeteer 下的 chrome-headless-shell
 * （`pnpm exec puppeteer browsers install chrome-headless-shell` 安装的位置）。
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import puppeteer, { type Browser } from 'puppeteer'

function findCachedExecutable(): string | undefined {
  const home = homedir()
  const roots = [
    path.join(home, '.cache', 'puppeteer'),
    path.join(home, 'Library', 'Caches', 'puppeteer'),
  ]
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const dir of ['chrome-headless-shell', 'chrome']) {
      const base = path.join(root, dir)
      if (!existsSync(base)) continue
      let subs: string[] = []
      try {
        subs = readdirSync(base)
      } catch {
        continue
      }
      for (const sub of subs) {
        const candidates = [
          path.join(base, sub, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell'),
          path.join(base, sub, 'chrome-headless-shell-mac-x64', 'chrome-headless-shell'),
          path.join(base, sub, 'chrome-headless-shell-linux64', 'chrome-headless-shell'),
          path.join(base, sub, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
          path.join(base, sub, 'chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
          path.join(base, sub, 'chrome-linux64', 'chrome'),
        ]
        for (const c of candidates) {
          if (existsSync(c)) return c
        }
      }
    }
  }
  return undefined
}

export async function launchBrowser(): Promise<Browser> {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || findCachedExecutable()
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  })
}
