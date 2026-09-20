import { createApp } from 'vue'
import App from './DesktopShell.vue'

if (window.animeLogDesktop && window.animeLogConfig?.apiBaseUrl) {
  createApp(App).mount('#app')
} else {
  document.getElementById('app').textContent = '请启动 Anime Log 桌面应用。此页面仅用于桌面开发，不提供浏览器模式。'
}
