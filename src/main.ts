import { createSSRApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
// 显式引入 uniCloud SDK（CLI 项目不会自动注入，需手动加载以设置 globalThis.uniCloud）
import '@dcloudio/uni-cloud';

export function createApp() {
  const app = createSSRApp(App);
  app.use(createPinia());
  return {
    app,
  };
}
