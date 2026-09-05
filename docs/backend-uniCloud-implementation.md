# 家庭打卡 · uniCloud 后端迁移实施文档

| 项目 | 内容 |
|---|---|
| 文档版本 | v0.1 |
| 编写日期 | 2026-09-05 |
| 适用项目 | 家庭打卡微信小程序（uni-app / Vue3 / TS / Pinia / Vitest） |
| 前置条件 | DCloud 账号已注册 ✅；uniCloud 服务空间已创建 ✅（支付宝云免费版 `familycheckinprogram`） |
| 小程序 AppID | wx0cae373d8c5573b8（src/manifest.json 已配置） |
| 当前版本 | 0.2.0（versionCode 200，本地存储，纯前端） |

> 本文档描述把「本地存储」的纯前端小程序升级为「uniCloud 服务端存储 + 登录 + 家庭空间 + 数据同步」的完整实施步骤。所有步骤按「先跑通最小闭环、再逐步迁移」推进。

---

## 1. 背景与目标

### 1.1 现状
- 当前所有数据保存在 `localStorage`，只存在于单一设备/浏览器的本地。
- 家庭成员无法跨设备、跨地点共享数据，也无法各自登录。
- 前端已具备良好的分层：`src/repositories/*`（仓储）→ `src/services/*`（服务）→ `src/stores/*`（Pinia store）→ 页面。迁移时**只替换最底层的存储实现，UI 基本不动**。

### 1.2 目标
1. 家庭成员通过**微信登录**获得统一身份；
2. 建立**家庭空间（familyId）**，成员通过邀请码加入同一空间，共享全部数据；
3. 档案、成员、饮食、运动、学习、食谱、出行、账本全部落到**云端数据库**；
4. 任一成员写入后，其他成员可看到最新数据（同步）；
5. 保留本地缓存与离线能力，支持「本地数据导入云端」迁移；
6. 满足安全与合规要求（登录鉴权、家庭隔离、隐私政策、备份）。

### 1.3 非目标（本期不做）
- 不做细粒度权限（如仅 owner 可改账本）——MVP 阶段成员默认可读写；
- 不做实时 WebSocket 推送——MVP 用「进入页面拉取 + 定时轮询」；
- 不做多家庭切换/一人多家庭——MVP 一账号一家庭（可后扩展）。

---

## 2. 技术选型确认

**结论：采用 uniCloud（支付宝云免费版，服务空间 `familycheckinprogram`，SpaceId `env-00jy6t350lew`），配合 uni-id / uni-id-pages 用户体系。**

理由：
- 与现有 uni-app 技术栈完全贴合，无需引入新框架；
- 云数据库（MongoDB 兼容）、云函数、云存储开箱即用，**无需自购服务器、域名、无需先备案**即可联调；
- uni-id 提供现成的注册/登录/微信登录/token 鉴权，**微信登录集成成本最低**；
- 阿里云提供**免费服务空间**（每个账号一个），满足开发期与 MVP 验证。

> 备选（暂不启用）：微信云开发 CloudBase（更贴近微信生态，但与 uni-app 多端目标耦合）、Supabase（PostgreSQL + Auth + Realtime，海外访问速度需评估）、自建后端（NestJS + PostgreSQL，长期产品再考虑）。

---

## 3. 总体架构

```
┌─────────────────────────────────────────────────────┐
│ 前端（uni-app，Vue3 + TS + Pinia）                     │
│  页面 → Store → Service → Repository（抽象接口）       │
│              ┌──────────────┴──────────────┐          │
│              ▼                             ▼          │
│    Remote Repository（云端）      Local Repository（缓存）│
│    uniCloud 云函数/云对象          localStorage + 待同步队列 │
└──────────────────┬──────────────────────────────────┘
                   │ uniCloud 客户端 SDK（uniCloud.callFunction）
┌──────────────────▼──────────────────────────────────┐
│ uniCloud 服务端（阿里云免费版）                        │
│  · uni-id 用户体系（登录/token/微信登录）               │
│  · 业务云对象/云函数：family / member / diet / workout │
│     study / meal / travel / ledger / sync / import    │
│  · 云数据库集合：families, family_members, diets,     │
│     workouts, study_plans, study_checkins, meal_plans,│
│     travels, travel_items, transactions               │
│  · DB Schema 校验 + 数据权限（按 uid/familyId）        │
└─────────────────────────────────────────────────────┘
```

**关键设计原则**
1. **离线优先（offline-first）**：读操作先取本地缓存再请求云端刷新；写操作先落本地「待同步队列」，再异步同步到云端，失败可重试。网络恢复后自动补同步。
2. **客户端生成 ID（UUID）**：所有业务记录由前端生成 `_id`/`clientId`，保证离线可生成、写入幂等（重复提交不产生脏数据）。
3. **抽象仓储层**：前端保留 `Repository` 接口，云端与本地只是两种实现，UI/Store/Service 不感知迁移。
4. **家庭数据归属**：每条业务数据必须携带 `familyId`；服务端校验 `uid` 是否属于该 `familyId`，杜绝越权访问。

---

## 4. 实施路线图

| 阶段 | 内容 | 出口验收 |
|---|---|---|
| **M0 最小闭环** | 开通服务空间；接入 uni-id-pages 微信登录；建家庭 + 邀请码 + 加入；双端看到同一份档案 | 两个微信号登录后可进同一家庭，档案一致 |
| **M1 核心档案** | 云端数据模型落库；个人档案 + 家庭成员远程化 | 档案/成员增删改查走云端，刷新不丢 |
| **M2 打卡模块** | 饮食、运动打卡远程化 | 打卡数据云端持久化 + 双端可见 |
| **M3 计划模块** | 学习计划、食谱、出行计划远程化 | 三类计划云端持久化 + 双端可见 |
| **M4 账本与迁移** | 收支账本远程化；「本地数据导入云端」入口 | 旧本地数据可一键导入，账本云端化 |
| **M5 上线** | 体验版/正式版；request 合法域名；隐私政策/用户协议；备份与导出 | 可正式使用，符合平台审核要求 |

> 建议每完成一个阶段就打一个版本标签并推送 GitHub（与现有 v0.2.0 / v0.1.0 分支惯例一致），便于回滚。

---

## 5. 前置准备：开通 uniCloud（下一步立即执行）

### 5.1 创建服务空间 ✅（已完成）
- 服务空间：**支付宝云免费版**，名称 `familycheckinprogram`，SpaceId `env-00jy6t350lew`
- 状态：正常；免费额度：云函数 1000GBs/月、调用 1.5 万次/月；数据库 62 万读 / 31 万写 / 月
- 到期：2026-10-04（免费周期，到期前需续期或升级）

### 5.2 关联服务空间到项目（需 HBuilderX）
1. 下载并安装 **HBuilderX**（Windows 绿色版，解压即用）：https://www.dcloud.io/hbuilderx.html
2. 用 HBuilderX 打开本项目；
3. 项目根目录右键 →「**创建 uniCloud 云开发环境**」（生成 `uniCloud` 目录）；
4. 对 `uniCloud` 目录右键 →「**关联云服务空间或项目…**」→ 选择 `familycheckinprogram`；
5. 关联成功后，项目出现 `uniCloud/cloudfunctions` 目录。

> ⚠️ **支付宝云不支持 CLI 发行**（uniCloud 官方限制）：云函数 / 公共模块 / DB Schema 只能通过 HBuilderX 上传，无法用命令行发行。因此本项目云端部署依赖 HBuilderX。

### 5.3 初始化数据库与部署
1. 在 `uniCloud/cloudfunctions` 下准备业务云对象（见第 7、8 章）；
2. 为各集合创建 **DB Schema**（含权限规则）；
3. `uniCloud/cloudfunctions` 右键 →「上传所有云函数、公共模块及 actions」。

---

## 6. 账号与登录（uni-id / uni-id-pages）

### 6.1 安装用户体系插件
1. 在 uni-app 插件市场（HBuilderX 内「插件市场」）导入 **uni-id-pages**（现成登录/注册/找回密码页面）与 **uni-id-co**（云对象公共模块，处理注册、登录、微信登录、token 签发）；
2. 导入时会一并带入 `uni-id` 公共模块与 `uni-config-center` 公共模块；
3. 关联服务空间后，在 HBuilderX 中「上传公共模块」到云端。

### 6.2 配置微信登录
1. 微信公众平台获取小程序 **AppID**（已有：`wx0cae373d8c5573b8`）与 **AppSecret**；
2. `src/manifest.json` → `mp-weixin.appid` 已配置（保持不变，`urlCheck` 开发期为 false）；
3. 云端 `uniCloud/cloudfunctions/common/uni-config-center/uni-id/config.json` 配置：
   ```json
   {
     "passwordSecret": [{"type": "hmac-sha256", "value": "自定义密钥"}],
     "tokenSecret": "自定义token密钥",
     "tokenExpiresIn": 259200,
     "loginTypes": ["weixin", "username", "smsCode"],
     "app": { "tokenExpiresIn": 259200 },
     "mp-weixin": {
       "oauth": {
         "weixin": {
           "appid": "wx0cae373d8c5573b8",
           "appsecret": "微信公众平台获取的 AppSecret"
         }
       }
     }
   }
   ```
   > **AppSecret 属于敏感信息，切勿提交到 GitHub**（项目已用 .gitignore 排除相关配置即可；或使用服务端环境变量）。
4. `src/pages.json` 增加登录页路由：`/uni_modules/uni-id-pages/pages/login/login-withoutpwd`；
5. 小程序端首次进入未登录时，跳转登录页；登录成功后 uni-id 返回 `uniIdToken`，前端存入本地并注入后续云函数请求。

### 6.3 用户表扩展
uni-id 用户集合为 `uni-id-users`，为其**增加自定义字段**（通过 DB Schema 扩展）：
```
familyId: string      // 所属家庭空间（空 = 未加入家庭）
familyRole: string    // owner | member
```

---

## 7. 数据模型设计（uniCloud 云数据库集合）

> 云数据库为 MongoDB 兼容文档型。除 uni-id-users 外，其余为业务集合。**所有业务集合强制携带 `familyId` 与 `clientId`（客户端生成的 UUID）**。

### 7.1 集合清单

| 集合名 | 说明 | 关键字段 |
|---|---|---|
| `uni-id-users` | 用户（uni-id 自带） | _id, username, wx_openid, familyId, familyRole |
| `families` | 家庭空间 | name, ownerUid, inviteCode, createdAt, memberCount |
| `family_members` | 家庭成员档案 | familyId, name, gender, birthday, height, weight, targetWeight, avatarColor, isSelf |
| `diets` | 饮食打卡 | familyId, memberId, date, mealType, content, calories, createdAt |
| `workouts` | 运动打卡 | familyId, memberId, date, type, duration, calories, note, createdAt |
| `study_plans` | 学习计划 | familyId, title, frequency, startDate, endDate, createdAt |
| `study_checkins` | 学习打卡 | familyId, planId, memberId, date, done, note |
| `meal_plans` | 家庭食谱 | familyId, date, mealType, dishes, note, createdAt |
| `travels` | 出行计划 | familyId, title, startDate, endDate, status, note |
| `travel_items` | 出行子项 | familyId, travelId, time, item, memberId, done |
| `transactions` | 收支记录 | familyId, type(income/expense), category, amount, date, note, memberId, createdAt |
| `sync_meta` | 同步元数据 | familyId, lastSyncAt, dataVersion |

> 对应关系：`family_members` ≈ 现有 `family` store 的成员档案；`diets/workouts` ≈ 现有打卡；`study_*` ≈ 学习；`meal_plans` ≈ 食谱；`travels/travel_items` ≈ 出行；`transactions` ≈ 账本。**前端 `src/types/models.ts` 的现有类型可在加 `familyId`/`clientId` 后复用**。

### 7.2 统一字段约定
```ts
interface BaseRecord {
  _id?: string          // 服务端主键（同步成功后回填）
  clientId: string      // 客户端 UUID（幂等/离线写入用）
  familyId: string      // 家庭空间归属
  createdAt: number
  updatedAt: number
}
```

---

## 8. 家庭空间：创建 / 邀请 / 加入 / 数据认领

### 8.1 流程
```
首次登录用户
  ├─ 未加入家庭 → 引导「创建家庭」或「输入邀请码加入」
  │    ├─ 创建家庭 → 生成 families 记录 + 生成6位邀请码 inviteCode
  │    │             → 用户成为 owner，写回 uni-id-users.familyId
  │    └─ 加入家庭 → 校验 inviteCode → 写回 familyId（role=member）
  └─ 已加入家庭 → 正常进入主页
```

### 8.2 云对象接口（示例签名）
| 方法 | 入参 | 说明 |
|---|---|---|
| `createFamily` | name | 创建家庭，返回 familyId + inviteCode |
| `joinFamily` | inviteCode | 加入家庭，校验后写入 familyId |
| `getFamilyInfo` | - | 返回家庭信息 + 成员列表 |
| `regenerateInviteCode` | - | owner 重置邀请码（旧码作废） |
| `removeMember` | memberId | owner 移除成员 |

### 8.3 数据认领（本地 → 云端迁移）
在 M4 提供一次性入口：
1. 用户登录并确认进入某家庭后，读取本地 `localStorage` 旧数据；
2. 为每条记录补齐 `familyId` 与 `clientId`（若无）后，批量写入云端（幂等，按 clientId 去重）；
3. 写入完成后本地缓存打上 `imported` 标记，避免重复导入；
4. 提供「导入前导出备份 JSON」按钮（复用现有 BackupService）。

---

## 9. 前端改造：远程仓储 + 离线队列

### 9.1 分层改造（改动最小）
- 保留 `src/repositories/*` 的接口签名与 `src/services/*`、`src/stores/*`；
- 新增 `src/repositories/remote/*`（调用 `uniCloud.callFunction` 或云对象）与 `src/repositories/sync/*`（离线队列）；
- 仓储层内部切换：网络可用 → Remote；网络不可用/失败 → Local 缓存 + 入队。

### 9.2 写入路径（离线优先）
```
Store.save(record)
  → 写入 localStorage（本地即时生效，UI 立即刷新）
  → 加入待同步队列 syncQueue（{action, payload, clientId}）
  → 调用云对象写入云端（幂等，按 clientId）
  → 成功：回填 _id/updatedAt，出队
  → 失败：保留在队列，下次进入/恢复网络时重试
```

### 9.3 读取路径
```
Store.list(familyId)
  → 先读本地缓存渲染（秒开）
  → 后台调云端拉取最新（增量，按 updatedAt）
  → 云端返回后合并更新缓存与 UI
```

### 9.4 需新增的目录/文件
```
src/repositories/remote/      FamilyRemoteRepo / DietRemoteRepo / WorkoutRemoteRepo /
                              StudyRemoteRepo / MealRemoteRepo / TravelRemoteRepo / LedgerRemoteRepo
src/repositories/sync/        SyncQueue.ts（队列）、SyncService.ts（重试/合并）
src/utils/uuid.ts             客户端 UUID 生成
src/utils/network.ts          网络状态检测
```

---

## 10. 同步策略

| 项 | 决策 |
|---|---|
| 触发时机 | 登录后全量拉取；每次进入 Tab/子页拉取增量；前台恢复时拉取 |
| 轮询 | MVP 每 5~10 分钟轮询一次（可选）；后续可换 WebSocket/云函数定时器 |
| 冲突处理 | **last-write-wins**：云端按 `updatedAt` 比较，晚写入者胜出；MVP 可接受 |
| 幂等 | 所有写入按 `clientId` 去重，重复请求不产生脏数据 |
| 失败重试 | 离线队列指数退避重试；数据永久冲突时保留本地副本并提示 |

---

## 11. 安全与权限

1. **登录鉴权**：所有云函数/云对象先校验 `uni-id` token（`uni-id-common` 校验），无效则拒绝；
2. **家庭隔离**：每条业务数据带 `familyId`，服务端校验「uid 属于该 familyId」后才允许读写（禁止传任意 familyId 越权）；
3. **DB Schema 权限**：业务集合设置 `permission` 规则（仅本人/本家庭可读），作为服务端校验的第二道防线；
4. **敏感字段**：AppSecret、tokenSecret 等存服务端配置，不进仓库/不入包；
5. **传输**：uniCloud 默认 HTTPS，小程序端禁止明文传输。

---

## 12. 合规与部署

### 12.1 request 合法域名（微信小程序）
正式版/体验版必须在小程序后台「设置 → 开发设置 → 服务器域名」配置合法域名：
- **支付宝云（本次选用，本空间实际域名）**：`https://env-00jy6t350lew.api-hz.cloudbasefunction.cn`
- 阿里云（备选）：`https://api.next.bspapp.com`
- 腾讯云（备选）：`https://tcb-api.tencentcloudapi.com` 及 `https://{spaceId}.ap-shanghai.tcb-api.tencentcloudapi.com`
- 如用到云存储上传/下载，需同时配置 `uploadFile` / `downloadFile` 合法域名。

> 开发期可保持 `urlCheck:false`（本地联调）；上线前务必关闭并配置合法域名。

### 12.2 隐私与合规
- 数据含**身高体重、家庭财务**等个人信息，属 PIPL（《个人信息保护法》）规范范围；
- 家庭成员可能含**未成年人**：小程序需在用户协议/隐私政策中说明信息收集范围、用途与监护人同意机制；
- 上线前需在微信公众平台配置「**用户隐私保护指引**」（收集信息类型声明），审核会检查；
- 建议同步完善「**用户协议 + 隐私政策**」页面，并在首次登录/注册时获得同意记录。

### 12.3 备案
- uniCloud 云函数/云存储联调**无需先备案**；
- 若后续使用**自定义域名**或 H5 前端网页托管对外提供正式服务，需完成 **ICP 备案**（uniCloud 控制台提供备案码申请入口）。

---

## 13. 备份与数据导出

1. **服务端备份**：uniCloud 控制台开启定时备份（云数据库备份策略），或定期导出集合到云存储；
2. **前端导出**：保留现有 BackupService「导出 JSON」能力，升级为「导出当前家庭全部数据」；
3. **版本记录**：每次迁移/导入前导出一次备份，作为回滚点；
4. 建议每完成 M0~M4 一个阶段，执行一次「导出 → 验证 → 清理旧缓存」演练。

---

## 14. 测试与验收

### 14.1 自动化测试（延续现有测试体系）
- `tests/*.test.ts`（Vitest）：仓储层增加 **remote 仓储 mock 测试** 与 **SyncQueue 幂等/重试测试**；
- `tests/test_*.py`：新增 `tests/test_backend_plan.py` 校验本文档章节完整性与数据模型一致性；
- 保持 `npm run type-check`、`npm run test`、`npm run build:h5`、`npm run build:mp-weixin` 全绿。

### 14.2 端到端验收（每阶段）
1. 两个微信账号 A/B 登录，A 创建家庭，B 用邀请码加入；
2. A 在档案页改身高，B 刷新后看到新值（跨设备同步）；
3. 断网时 A 新增打卡，恢复网络后自动同步成功，B 可见；
4. 旧本地数据导入云端后，刷新不丢失、不重复。

---

## 15. 风险与待确认项

| 项 | 说明 | 处置 |
|---|---|---|
| 阿里云免费空间配额 | 并发/存储有限 | 前期够用；超限前升级付费或按量 |
| HBuilderX vs CLI 工作流 | 云函数上传目前依赖 HBuilderX/控制台 | 统一用 HBuilderX 管理云端；代码进 git |
| AppSecret 泄露风险 | 配置含密钥 | 不入库、用环境变量/服务端配置 |
| 未成年人数据合规 | 涉及个人信息保护 | 上线前完善隐私政策与监护人同意 |
| 小程序类目/审核 | 家庭工具类目 | 提前在公众平台确认类目与所需资质 |
| 一人多家庭/家庭解散 | MVP 不支持 | 预留 schema 字段，后续迭代 |
| 实时性要求 | MVP 为轮询 | 若需秒级同步再引入 WebSocket |

---

## 附录：参考链接

- HBuilderX 下载（Windows 绿色版）：https://www.dcloud.io/hbuilderx.html
- uniCloud 快速上手（创建/关联服务空间）：https://doc.dcloud.net.cn/uniCloud/quickstart.html
- uniCloud 控制台：https://unicloud.dcloud.net.cn/
- uni-id / uni-id-pages 文档：https://doc.dcloud.net.cn/uniCloud/uni-id/app.html
- uni-id 云对象（uni-id-co）：https://doc.dcloud.net.cn/uniCloud/uni-id/cloud-object.html
- uniCloud 发行与小程序合法域名：https://doc.dcloud.net.cn/uniCloud/publish.html
- 云函数 HTTP 访问地址（URL 化）：https://doc.dcloud.net.cn/uniCloud/http.html

---

## 下一步（待办）

- [x] M0-1a：创建服务空间（支付宝云免费版 `familycheckinprogram`，✅ 2026-09-05 确认）
- [ ] M0-1b：安装 HBuilderX，创建 uniCloud 目录并关联服务空间
- [ ] M0-2：导入 uni-id-pages / uni-id-co，配置微信登录（appid + appsecret）
- [ ] M0-3：设计并创建 `families` / `family_members` 集合（DB Schema）
- [ ] M0-4：实现 createFamily / joinFamily / getFamilyInfo 云对象
- [ ] M0-5：前端登录页接入 + 家庭创建/加入页 + 双端联动验收
