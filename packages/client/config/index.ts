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

// Taro 的 compile.include 未稳定传递到 script rule，这里在 webpackChain 中
// 直接把 shared 源码目录加进 babel-loader 的 include，双端共用。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function includeSharedSrc(chain: any) {
  chain.module.rule('script').include.add(sharedSrc)
  for (const p of pluginExtraIncludes) chain.module.rule('script').include.add(path.resolve(p))
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
      patterns: [],
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
      '@': path.resolve(__dirname, '..', 'src'),
      '@coeditor/shared': path.resolve(__dirname, '..', '..', 'shared', 'src', 'types.ts'),
      '@plugin-registry': process.env.PLUGIN_REGISTRY_PATH
        ? path.resolve(process.env.PLUGIN_REGISTRY_PATH)
        : path.resolve(__dirname, '..', 'src/plugin/registry.ts'),
    },
    // outputRoot 在平台子配置中运行时生效，但类型定义缺失，故用 spread 携带
    mini: {
      ...({ outputRoot: 'dist-weapp' }),
      webpackChain(chain) {
        includeSharedSrc(chain)
      },
      postcss: {
        pxtransform: {
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
    h5: {
      ...({ outputRoot: 'dist-h5' }),
      publicPath: '/',
      staticDirectory: 'static',
      webpackChain(chain) {
        includeSharedSrc(chain)
      },
      devServer: {
        port: 5173,
        proxy: {
          '/api': {
            target: 'http://localhost:3001',
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

  // 开发与生产构建共用同一份配置，无按环境覆盖项。
  // 压缩/混淆不在这里配置，由 Taro 按 NODE_ENV 内置处理（生产构建默认开启压缩）。
  return baseConfig
})
