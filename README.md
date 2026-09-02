# 健身饮食记录

面向个人使用的健身与饮食记录 MVP，基于 uni-app、Vue 3、TypeScript 和 Pinia。

## 功能

- 维护健康档案。
- 按日期记录、编辑和删除饮食与训练。
- 查看今日记录和历史记录。
- 导出和导入本地 JSON 备份。

## 本地开发

```bash
npm install
npm run dev:h5
```

微信小程序开发：

```bash
npm run dev:mp-weixin
```

## 验证

```bash
npm run type-check
npm test
```

## 目录结构

```text
src/
  components/   通用表单组件
  pages/        页面
  repositories/ 本地数据仓储
  services/     业务服务
  storage/      存储适配器
  stores/       Pinia 状态
  types/        数据模型
  utils/        通用工具
tests/          Vitest 测试
docs/           产品与技术方案
```
