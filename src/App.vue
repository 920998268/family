<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';

onLaunch(() => {
  // 家庭打卡 MVP：数据统一由本地仓储负责，暂不涉及云端登录与同步。
});
</script>

<style lang="scss">
@import "./styles/app.scss";

page {
  min-height: 100%;
  background: #faf6f1;
  color: #2d2a26;
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
