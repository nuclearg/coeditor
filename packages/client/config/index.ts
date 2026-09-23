import { defineConfig, type UserConfigExport } from '@tarojs/cli'
import path from 'path'

// shared 包以 .ts 源码形式被引用，需要纳入 babel-loader 处理范围
const sharedSrc = path.resolve(__dirname, '..', '..', 'shared', 'src')

// 外部插件目录（逗号分隔的绝对路径）——PLUGIN_REGISTRY_PATH 指向的注册表
// 若 import 了仓库外的插件源码，需通过该变量把它们加进 babel include。
const pluginExtraIncludes: string[] = (process.env.PLUGIN_EXTRA_INCLUDE || '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean)

/**
 * 深合并宿主注入的配置（见文件末尾 TARO_CONFIG_EXTEND）。
 *
 * 只对**纯对象**递归：数组、函数、类实例一律整体替换——Taro 配置里的 webpackChain 是函数、
 * copy.patterns 是数组，它们"合并"没有语义，替换才对。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): void {
  if (!source || typeof source !== 'object') return
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      deepMerge(target[key], value)
    } else {
      target[key] = value
    }
  }
}

// Taro 的 compile.include 未稳定传递到 script rule，这里在 webpackChain 中
// 直接把 shared 源码目录加进 babel-loader 的 include，双端共用。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function includeSharedSrc(chain: any) {
  chain.module.rule('script').include.add(sharedSrc)
  for (const p of pluginExtraIncludes) chain.module.rule('script').include.add(path.resolve(p))
}

// 单例包：仓库外插件（PLUGIN_EXTRA_INCLUDE）会从插件自己的 node_modules 解析这些包，
// 与 client 自身的副本形成两份实例。React 双实例会让 hooks dispatcher 为 null
// （运行时表现：Cannot read properties of null (reading 'useState')）。
// 这里统一钉到 client 自己的副本——开源版本来就只有一份，属幂等兜底。
//
// 不要钉 react-dom：Taro 生成的入口本身就 `import ReactDOM from 'react-dom'`
// 并交给 createReactApp，小程序端由 Taro 自己处理这个标识符。一旦在此覆盖，
// 会把真正的 react-dom 拽进小程序包——它的 host config 会访问
// window.HTMLIFrameElement，运行时抛
// "TypeError: Right-hand side of 'instanceof' is not an object"。
const singletonAlias = {
  react: path.dirname(require.resolve('react')),
  zustand: path.dirname(require.resolve('zustand')),
}

// https://taro-docs.jd.com/docs/next/config
export default defineConfig(async () => {
  const baseConfig: UserConfigExport = {
    projectName: 'coeditor',
    date: '2026-8-12',
    designWidth: 750,
    deviceRatio: {
      640: 2.34 / 2,
      750: 1,
      375: 2,
      828: 1.81 / 2,
    },
    sourceRoot: 'src',
    // 顶层 outputRoot 仅作默认占位（Kernel 初始化需要），
    // 实际输出目录以 mini/h5 子配置中的 outputRoot 为准（平台构建时生效）
    outputRoot: 'dist',
    plugins: ['@tarojs/plugin-html'],
    // API 后端地址，编译时注入。留空（默认）时走相对路径 /api/*（同域或反代）。
    // 示例：API_BASE_URL=https://api.example.com pnpm build:h5
    defineConstants: {
      API_BASE_URL: JSON.stringify(process.env.API_BASE_URL || ''),
    },
    copy: {
      patterns: [
        // 浏览器 favicon：构建时原样复制到 dist-h5 根目录（index.html 中按 /favicon.* 引用）
        { from: 'src/favicon.ico', to: 'dist-h5/favicon.ico' },
        { from: 'src/favicon.png', to: 'dist-h5/favicon.png' },
      ],
      options: {},
    },
    framework: 'react',
    // dev 模式的 prebundle 会生成 webpack 5.79+ 才支持的 output.environment 配置，
    // 而项目 webpack 固定在 5.78（生产构建兼容性），故关闭 prebundle
    compiler: {
      type: 'webpack5',
      prebundle: {
        enable: false,
      },
    },
    cache: {
      enable: false,
    },
    alias: {
      ...singletonAlias,
      '@': path.resolve(__dirname, '..', 'src'),
      '@coeditor/shared': path.resolve(__dirname, '..', '..', 'shared', 'src', 'types.ts'),
      '@plugin-registry': process.env.PLUGIN_REGISTRY_PATH
        ? path.resolve(process.env.PLUGIN_REGISTRY_PATH)
        : path.resolve(__dirname, '..', 'src/plugin/registry.ts'),
    },
    // outputRoot 在平台子配置中运行时生效，但类型定义缺失，故用 spread 携带
    //
    // 这里**只留平台中立的部分**：webpackChain 是"把 shared 源码与宿主注入的插件目录
    // 纳入 babel-loader"的钩子，H5 侧有一份一模一样的（见下面 h5.webpackChain）。
    // 小程序**特有的**构建配置（产物目录 dist-weapp、mini 的 postcss 等）不在这里：
    // 基座只用 Taro 框架、不产出小程序包，那些由宿主经 TARO_CONFIG_EXTEND 注入（见文件末尾）。
    mini: {
      webpackChain(chain) {
        includeSharedSrc(chain)
        // 注意：这里**不要**为 react-dom 设置任何 alias。
        // Taro 生成的入口是 `import ReactDOM from 'react-dom'` + `createReactApp(React, ReactDOM, config)`，
        // 小程序端由 Taro 自己接管该标识符（产物中不含 react-dom）。
        // 一旦覆盖成真实包路径或 false：前者会把 react-dom 拽进产物并在运行时抛
        // "Right-hand side of 'instanceof' is not an object"（其 host config 访问
        // window.HTMLIFrameElement）；后者会连 Taro 的 React 渲染器一起删掉。
      },
    },
    h5: {
      ...({ outputRoot: 'dist-h5' }),
      publicPath: '/',
      staticDirectory: 'static',
      webpackChain(chain) {
        includeSharedSrc(chain)
      },
      devServer: {
        // E2E 测试用独立端口（E2E_DEV_PORT），避免与正在开发的 5173 冲突
        port: Number(process.env.E2E_DEV_PORT) || 5173,
        // SSE（ai.chat 流式输出）不能被压缩：gzip/br 会把整个响应缓冲到结束才下发，
        // 浏览器端拿不到逐块增量（流式打字机失效）。
        compress: false,
        proxy: {
          '/api': {
            // E2E 测试时后端也在独立端口（E2E_BACKEND_PORT）
            target: `http://localhost:${process.env.E2E_BACKEND_PORT || 3001}`,
            changeOrigin: true,
          },
        },
      },
      postcss: {
        // H5 端关闭 pxtransform：CSS 中的 px 保持物理像素（web 标准行为），
        // 与内联 style 的 px 单位一致，避免 rem 缩放导致字号/间距失控
        pxtransform: {
          enable: false,
        },
        autoprefixer: {
          enable: true,
          config: {},
        },
        cssModules: {
          enable: false,
          config: {
            namingPattern: 'module',
            generateScopedName: '[name]__[local]___[hash:base64:5]',
          },
        },
      },
    },
  }

  // ===== 宿主注入的额外 Taro 配置（平台中性的扩展点）=====
  //
  // `TARO_CONFIG_EXTEND` 指向一个模块的绝对路径（.js / .cjs，CommonJS），其导出对象会被
  // **深合并**进上面的 baseConfig（同键后者覆盖，纯对象递归合并）。
  //
  // 为什么需要它：基座只用 Taro 框架、**不产出小程序包**，所以小程序特有的构建配置
  // （产物目录 dist-weapp、mini 的 postcss 等）不应该长在基座里。Taro 4.2 没有 `--config`
  // 之类的"换配置文件"开关（`taro build --help` 可证），宿主无法自带一份配置，于是这里留一个
  // 注入点：由宿主（coeditor-saas 的 build.sh）在构建小程序时注入。
  // 与既有注入点同一套思路：PLUGIN_REGISTRY_PATH / PLUGIN_EXTRA_INCLUDE / API_BASE_URL。
  //
  // 深合并的意义：宿主只写它要补的键（如 `mini.outputRoot`），不会把基座的
  // `mini.webpackChain`（includeSharedSrc）整块顶掉——那是"把 shared 源码与宿主插件目录
  // 纳入 babel-loader"的必需钩子，被顶掉会直接编译失败。
  const extendPath = process.env.TARO_CONFIG_EXTEND
  if (extendPath) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const injected = require(path.resolve(extendPath))
    deepMerge(baseConfig, injected?.default ?? injected)
  }

  // 开发与生产构建共用同一份配置，无按环境覆盖项。
  // 压缩/混淆不在这里配置，由 Taro 按 NODE_ENV 内置处理（生产构建默认开启压缩）。
  return baseConfig
})
