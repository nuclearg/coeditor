export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/edit/index',
    'pages/settings/index',
    // 自定义扩展页面位（page.custom.1 ~ 10）：开源版预留，由插件注册组件填充（缺省占位提示）
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
})
