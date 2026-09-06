import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

// CLI 项目使用 uniCloud 需要在构建时注入服务空间配置
// 配置从 .env.local 读取（该文件已加入 .gitignore，不会提交到 Git）
const uniCloudProvider =
  process.env.UNI_CLOUD_SPACE_ID && process.env.UNI_CLOUD_ACCESS_KEY
    ? [
        {
          spaceId: process.env.UNI_CLOUD_SPACE_ID,
          spaceAppId: process.env.UNI_CLOUD_SPACE_APP_ID || '',
          provider: 'alipay',
          accessKey: process.env.UNI_CLOUD_ACCESS_KEY,
          secretKey: process.env.UNI_CLOUD_SECRET_KEY,
        },
      ]
    : [];

export default defineConfig({
  plugins: [uni()],
  define: {
    'process.env.UNI_CLOUD_PROVIDER': JSON.stringify(uniCloudProvider),
  },
});
