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
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#fff',
    navigationBarTitleText: 'CoEditor',
    navigationBarTextStyle: 'black',
  },
  // 小程序跟随系统夜间模式的**前提**：开启 darkmode 后，wx.getAppBaseInfo().theme 才有值、
  // wx.onThemeChange 才会回调（见官方 DarkMode 适配指南）。缺了它，小程序端拿不到系统主题，
  // 只能一直显示日间——stores/theme.ts 的 systemTheme() 就是读这个字段。
  // 运行时导航栏配色由 app.tsx 的 setNavigationBarColor 跟随主题覆盖，不依赖这里的静态值。
  darkmode: true,
})
