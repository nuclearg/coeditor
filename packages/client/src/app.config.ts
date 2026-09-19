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
    // **系统主题**在 theme.json 的 light/dark 两组之间取值。写死白色的话，切页时新页面的
    // 导航栏会先按静态值渲染成白色、等 JS 改回来，表现为"黑→白→黑"闪一下
    // （setNavigationBarColor 只作用于当前页面，切页必然回落）。
    backgroundTextStyle: '@bgTxtStyle',
    navigationBarBackgroundColor: '@navBgColor',
    navigationBarTitleText: 'CoEditor',
    navigationBarTextStyle: '@navTxtStyle',
    backgroundColor: '@bgColor',
  },
  // 变量表（src/theme.json，构建时复制到产物根目录；见 config/index.ts 的 copy 配置）
  themeLocation: 'theme.json',
  // 小程序跟随系统夜间模式的**前提**：开启 darkmode 后，wx.getAppBaseInfo().theme 才有值、
  // wx.onThemeChange 才会回调（见官方 DarkMode 适配指南）。缺了它，小程序端拿不到系统主题，
  // 只能一直显示日间——stores/theme.ts 的 systemTheme() 就是读这个字段。
  // 运行时导航栏配色由 app.tsx 的 setNavigationBarColor 跟随主题覆盖，不依赖这里的静态值。
  darkmode: true,
})
