<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';

onLaunch(() => {
  // MVP 阶段无需初始化云端或登录状态，应用数据统一由本地仓储负责。
});
</script>

<style lang="scss">
@import "./styles/app.scss";

page {
  min-height: 100%;
  background: #f5f6f8;
  color: #1f2328;
  font-family:
    -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}

view,
text,
button,
input,
textarea,
picker {
  box-sizing: border-box;
}

button {
  border: 0;
  line-height: 1;
}
</style>
