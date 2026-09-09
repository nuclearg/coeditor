/**
 * E2E 环境常量：端口与地址。所有进程（global-setup 与测试 worker）都从同一
 * 组环境变量推导，保证一致。
 */

export interface E2EEnv {
  /** 后端服务端口（server 的 PORT 环境变量） */
  backendPort: number
  /** H5 dev server 端口（client config 的 E2E_DEV_PORT） */
  devPort: number
  /** mock AI 上游端口 */
  mockPort: number
}

function readPort(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export function getE2EEnv(): E2EEnv {
  return {
    backendPort: readPort('E2E_BACKEND_PORT', 3101),
    devPort: readPort('E2E_DEV_PORT', 5175),
    mockPort: readPort('E2E_MOCK_PORT', 3199),
  }
}

export const backendBase = (): string => `http://localhost:${getE2EEnv().backendPort}`
export const devBase = (): string => `http://localhost:${getE2EEnv().devPort}`
