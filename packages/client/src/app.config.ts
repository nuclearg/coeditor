export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/edit/index',
    'pages/settings/index',
    // 自定义扩展页面位（page.custom.1 ~ 10）：框架预留，由插件注册组件填充（缺省占位提示）
    'pages/custom/1',
    'pages/custom/2',
    'pages/custom/3',
    'pages/custom/4',
    'pages/custom/5',
    'pages/custom/6',
    'pages/custom/7',
    'pages/custom/8',
    'pages/custom/9',
    'pages/custom/10',
  ],
  window: {
    // 应用级默认标题：H5 也用它兜底（页面自己会再设标题）
    navigationBarTitleText: 'CoEditor',
  },
  // 这里**没有**任何小程序专属键（window 的导航栏/窗口配色 @变量、themeLocation、darkmode）：
  // 基座只用 Taro 框架、不产出小程序包，这些键由宿主在构建后写进 dist-weapp/app.json
  // （见 coeditor-saas 的 build.sh 与 weapp/patch-app-json.js；theme.json 变量表同样在宿主侧）。
  // 对 H5 构建它们本来就是惰性键，搬走后 H5 行为不变。
})
