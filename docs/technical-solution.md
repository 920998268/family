# 家庭打卡微信小程序 技术方案

## 1. 背景与目标

本方案面向「家庭打卡」微信小程序，覆盖运动饮食打卡、学习计划打卡、家庭食谱、出行计划、家庭收支与个人信息档案六大模块。本期仅实现前端页面与本地数据层，不引入后端服务、云数据库和登录系统。

技术目标：以 uni-app 输出微信小程序（同时保留 H5），用本地 JSON 存储支撑完整的前端功能闭环，并通过单元测试保障领域逻辑正确性。

## 2. 技术选型

### 2.1 总体技术栈

| 层级 | 技术 | 说明 |
| --- | --- | --- |
| 跨端框架 | uni-app 3.x | 一套代码输出微信小程序、H5、Android 和 iOS |
| 前端框架 | Vue 3 | 使用 Composition API 组织页面和组件 |
| 开发语言 | TypeScript | 为数据模型、存储接口和业务逻辑提供类型约束 |
| 状态管理 | Pinia | 管理各模块状态与当前日期 |
| 构建工具 | Vite + @dcloudio/vite-plugin-uni | uni-app 的 Vite 构建链路 |
| UI 组件 | 基础组件 + 自定义组件 | 避免引入过重 UI 框架 |
| 本地存储 | uni.setStorageSync / uni.getStorageSync | 前端阶段使用本地 JSON 存储 |
| 测试 | Vitest | 对领域逻辑、仓储、服务和状态做单元测试 |
| 版本管理 | Git | 每次功能改动独立提交，便于回滚 |

### 2.2 选型理由

- 需要支持微信小程序并保留 H5 预览能力，uni-app 是国内生态中成本较低的跨端方案。
- 家庭记录数据量小，本地 JSON 存储足以覆盖本期需求。
- 本期明确不做后端，避免引入服务端、云数据库和用户体系。
- Vue 3 + TypeScript 适合中小型应用，后续维护成本可控。

### 2.3 不采用的方案

- Electron：面向桌面端，不适合移动小程序场景。
- 原生微信小程序：后续输出 H5 或独立 App 需重写。
- Flutter：对微信小程序的直接支持不成熟。
- 云数据库：无跨设备同步需求，本期显著增加复杂度。

## 3. 总体架构

产品采用本地优先的单机架构，页面通过 Pinia 访问业务服务，业务服务通过仓储层访问本地存储，仓储层依赖存储适配器隔离多端差异。

```text
页面与组件
  -> Pinia 状态
    -> 业务服务
      -> 仓储层
        -> 本地存储适配器
          -> uni.setStorageSync / uni.getStorageSync
```

核心原则：

- 页面不直接读写本地存储，统一通过仓储层访问。
- 仓储层屏蔽微信小程序、H5 和 App 的存储差异。
- 数据模型与业务规则集中在服务层，便于未来迁移到 SQLite 或云同步。

## 4. 数据存储

### 4.1 存储策略

本地 JSON 存储，按集合或日期拆分 key：

```text
family.profile.v1
family.family.members.v1
family.diet.v1.<yyyy-MM-dd>
family.workout.v1.<yyyy-MM-dd>
family.study.plans.v1
family.study.checkin.v1.<yyyy-MM-dd>
family.meal.v1.<yyyy-MM-dd>
family.travel.plans.v1
family.ledger.v1.<yyyy-MM-dd>
```

按日期拆分的数据（饮食、训练、学习打卡、食谱、收支）保存该日期下的完整记录数组；集合型数据（家庭成员、学习计划、出行计划）保存完整数组。

### 4.2 数据模型

```ts
type Gender = 'male' | 'female' | 'other';
type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
type MemberRole = 'parent' | 'child' | 'elder' | 'other';
type StudyFrequency = 'daily' | 'weekly';
type TravelStatus = 'planned' | 'ongoing' | 'done' | 'cancelled';
type TransactionType = 'income' | 'expense';

interface Profile {
  name: string;
  gender: Gender;
  birthDate: string;
  heightCm: number;
  currentWeightKg: number;
  targetWeightKg: number;
}

interface FamilyMember {
  id: string;
  name: string;
  role: MemberRole;
  avatarColor: string;
}

interface StudyPlan {
  id: string;
  title: string;
  subject: string;
  frequency: StudyFrequency;
  targetTimes: number;
  memberId?: string;
  createdAt: string;
}

interface StudyCheckin {
  id: string;
  planId: string;
  date: string;
  note: string;
  memberId?: string;
}

interface MealPlan {
  id: string;
  date: string;
  slot: MealType;
  dishName: string;
  ingredients: string;
  cook: string;
  done: boolean;
  note: string;
}

interface TravelPlan {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  destination: string;
  members: string[];
  budget: number;
  status: TravelStatus;
  note: string;
  items: TravelItem[];
}

interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  category: string;
  date: string;
  memberId?: string;
  note: string;
}
```

### 4.3 数据备份

本地存储不跨设备同步，因此提供：

- 全量 JSON 导出（包含档案、家庭成员、饮食、训练、学习、食谱、出行、收支）。
- 全量 JSON 导入，导入前覆盖确认。
- 备份版本号 v2，导入时校验全部集合。

## 5. 功能模块

### 5.1 页面划分

| Tab / 页面 | 主要功能 |
| --- | --- |
| 首页 | 今日打卡概览、食谱进度、出行计划、本月收支、六大模块入口 |
| 打卡 | 运动/饮食/学习打卡入口与今日进度 |
| 计划 | 家庭食谱与出行计划入口与进度 |
| 账本 | 收支汇总与流水 |
| 我的 | 个人信息档案、家庭成员、数据备份 |
| 饮食打卡 / 运动打卡 | 按日期与成员记录、编辑、删除 |
| 学习打卡 | 计划管理 + 每日打卡 |
| 家庭食谱 | 按日期与餐次制定、执行、编辑、删除 |
| 出行计划 / 出行计划编辑 | 计划列表、状态管理、行程明细编辑 |
| 记账表单 | 收入/支出新增与编辑 |
| 个人信息档案 | 姓名、性别、出生年月、身高体重、目标体重 |
| 家庭成员 | 成员新增、编辑、删除 |
| 数据备份 | 导出与导入 JSON |

### 5.2 业务规则

- 饮食按日期和餐次组织，营养字段可选，记录可关联成员。
- 训练按日期和动作组织，组明细按顺序保存，记录可关联成员。
- 学习计划每个计划每天最多打卡一次；删除计划时同步清理其打卡记录。
- 食谱按日期和餐次组织，标记执行状态并统计进度。
- 出行计划状态机：计划中 → 进行中 → 已完成；可取消；行程项可逐项标记完成。
- 收支按日期记录，支出与收入分类联动，本月汇总收入/支出/结余。
- 家庭成员是各记录可选关联对象，删除成员不影响历史记录。

## 6. 项目结构

```text
.
├── docs
│   ├── product-design.md
│   └── technical-solution.md
├── scripts
│   └── generate_tab_icons.py
├── src
│   ├── components
│   │   ├── DietForm.vue
│   │   ├── WorkoutForm.vue
│   │   ├── MemberAvatar.vue
│   │   ├── MemberSelect.vue
│   │   └── MemberMultiSelect.vue
│   ├── pages
│   │   ├── home
│   │   ├── checkin
│   │   ├── plan
│   │   ├── ledger
│   │   ├── me
│   │   └── backup
│   ├── stores
│   ├── services
│   ├── repositories
│   ├── storage
│   ├── static/tabbar
│   ├── styles
│   ├── types
│   ├── utils
│   └── App.vue
├── tests
└── package.json
```

## 7. 测试策略

### 7.1 单元测试

使用 Vitest 覆盖：

- 各数据模型校验（含边界与非法数据）。
- 各领域仓储的按日期/按集合读写逻辑。
- 各业务服务的增删改查、状态流转与去重规则。
- 备份导出导入的完整闭环。
- Pinia 状态与仓储的一致性。

测试使用内存存储适配器，不依赖运行环境。

### 7.2 手工验证

发布前在微信开发者工具 / H5 验证：

- 首次填写个人信息档案、添加家庭成员。
- 六大模块的新增、编辑、删除与查看。
- 学习计划每日打卡与取消。
- 食谱标记执行与进度统计。
- 出行计划状态流转与行程项完成。
- 账本收入/支出汇总与筛选。
- 数据导出后重新导入。

## 8. 发布策略

- 优先在微信开发者工具调试，输出 H5 作为预览验证。
- 本期不引入云开发、云数据库和服务器域名。
- 小程序体验版供家庭成员试用，稳定后正式发布。

## 9. 里程碑

1. 初始化 uni-app、Vue 3、TypeScript、Pinia 与测试环境。
2. 扩展数据模型、存储键、校验与仓储层。
3. 完成家庭成员与个人信息档案。
4. 完成首页看板与 5 个 Tab 导航。
5. 完成运动、饮食、学习打卡。
6. 完成家庭食谱与出行计划。
7. 完成家庭账本与记账表单。
8. 完成数据备份并升级到全领域。
9. 通过 type-check 与全部测试，H5 构建验证。

## 10. 风险与应对

| 风险 | 影响 | 应对方式 |
| --- | --- | --- |
| 本地数据丢失 | 家庭长期记录不可恢复 | 提供全领域 JSON 导出导入 |
| 小程序存储容量限制 | 数据增长后无法继续保存 | 按日期拆分 key，后续迁移本地数据库或轻量云备份 |
| 多端存储行为不一致 | 小程序、H5、App 行为不同 | 通过存储适配器隔离差异 |
| 家庭成员对象引用失效 | 成员删除后历史记录展示受影响 | 记录保存成员名缓存兜底，显示时回退 |
| 后续统计需求增加 | 当前 JSON 查询能力有限 | 保留仓储层边界，未来引入 SQLite 或云同步 |

## 11. 前端阶段技术边界

当前版本明确不实现：

- 云数据库、云同步、登录与权限体系。
- 食物库、动作库和模板系统。
- 营养分析、趋势图、统计报表与 AI 建议。
- 消息提醒、社交与排行榜。
- 可穿戴设备同步。

这些能力通过仓储层与数据模型预留扩展空间。
