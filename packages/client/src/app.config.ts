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
    // 这些值用 theme.json 的变量（@xxx）而不是写死：小程序开启 darkmode 后，框架会按
    // **系统主题**在 theme.json 的 light/dark 两组之间取值。
    //
    // **变量表本身不在本仓库**：theme.json 属小程序专属资产，由宿主（coeditor-saas 的
    // weapp/theme.json）在构建小程序时放到产物根目录。基座只用 Taro 框架、不产出小程序包，
    // 所以这里只声明"引用它"，不持有它的内容（这些键对 H5 构建是惰性的，H5 会忽略）。
    // 宿主那份里导航栏是**固定品牌主色**（两组同值），因此切页首帧画的就是最终色——
    // 具体原因见 coeditor-saas/plugins/weapp/theme.ts 的头注释。
    backgroundTextStyle: '@bgTxtStyle',
    navigationBarBackgroundColor: '@navBgColor',
    navigationBarTitleText: 'CoEditor',
    navigationBarTextStyle: '@navTxtStyle',
    backgroundColor: '@bgColor',
  },
  // 变量表文件名。微信要求它与 app.json 同级（即产物根目录），由宿主构建时放入。
  themeLocation: 'theme.json',
  // 小程序跟随系统夜间模式的**前提**：开启 darkmode 后，wx.getAppBaseInfo().theme 才有值、
  // wx.onThemeChange 才会回调（见官方 DarkMode 适配指南）。缺了它，小程序端拿不到系统主题，
  // 只能一直显示日间——stores/theme.ts 的 systemTheme() 就是读这个字段。
  darkmode: true,
})
