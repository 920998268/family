# x-uni-id-co 模块使用说明

## 概述

将 uni-id-pages 中的 uni-id-co 云对象抽离出来作为公共模块使用，同时**支持在自己的云函数/云对象中调用 uni-id-co 云对象的方法** [uni-id-co 文档](https://doc.dcloud.net.cn/uniCloud/uni-id/cloud-object.html)


## 如何调用 uni-id-co 云对象的方法（通过新增模块 callAdapter 获取 uni-id-co 云对象实例）

callAdapter 用于适配在云函数（cloudfunction）和云对象（cloudobject）中调用 uni-id-co 云对象的方法

**为什么不使用 `uniCloud.importObject('uni-id-co')` 调用，要使用 `callAdapter` 这种方式调用？**

因为云函数有冷启动过程，详见[云函数冷启动、热启动](https://doc.dcloud.net.cn/uniCloud/cf-functions.html#launchtype)
在需要和自己业务逻辑搭配使用 uni-id-co 时影响请求响应时间

### 在云函数中使用 uni-id-co

```js
const { callAdapter } = require('x-uni-id-co');

exports.main = async (event, context) => {
    const uniIdCoInstance = callAdapter.cloudfunction(context, event);
    // 使用 uniIdCoInstance 调用 uniIdCo 的方法
    const result = await uniIdCoInstance.login(event);
    return result;
}
```

### 在云对象中使用 uni-id-co

```js
const { callAdapter } = require('x-uni-id-co');

module.exports = {
    _before: function() {
        // 初始化逻辑
    },
    login: function(params) {
        const uniIdCoInstance = callAdapter.cloudobject(this);
        // 使用 uniIdCoInstance 调用 uniIdCo 的方法
        return uniIdCoInstance.login(params);
    }
}
```


## 依赖的 DB Schema 表结构, 使用前确保这些表已创建(在控制台创建表选择uni-id表分类创建, 再单独补充缺少的表结构)
```
uni-id-users
uni-id-log
uni-id-device
uni-id-roles
uni-id-permissions
opendb-department
opendb-verify-codes
opendb-open-data
opendb-frv-logs
opendb-device
opendb-app-list
```



## 新增模块

### callAdapter 模块, 用于在自己的云函数/云对象中调用 uni-id-co 云对象的方法
```js
const { callAdapter } = require('x-uni-id-co');
```

## uni-id-co 模块结构 (已开放出 uni-id-co 所有的模块, 根据目录查找相关功能函数, 在使用以下模块时注意 this 的问题)

### 使用示例

#### 云对象-生成/校验密码（参考 uni-id-co 源码实现）
```js
const { lib, common } = require('x-uni-id-co');

module.exports = {
    // 生成密码
    generatePassword(params) {
        const { password } = params

        const { password: PasswordUtils, config: ConfigUtils } = lib.utils
        
        common.universal.call(this)
        
        const passwordInfo = new PasswordUtils({
            clientInfo: this.getUniversalClientInfo(),
            passwordSecret: new ConfigUtils({ context: this }).getPlatformConfig().passwordSecret
        }).generatePasswordHash({
            password
        })
        
        console.log('passwordInfo', passwordInfo);
        
        return passwordInfo
    },
    // 校验密码（判断 password 和 passwordHash 是否匹配）
    checkPassword(params){
        const { password, passwordHash, version } = params

        const { password: PasswordUtils, config: ConfigUtils } = lib.utils
        
        common.universal.call(this)
        
        const passwordUtils = new PasswordUtils({
            userRecord: {
                password: passwordHash,
                password_secret_version: version
            },
            clientInfo: this.getUniversalClientInfo(),
            passwordSecret: new ConfigUtils({ context: this }).getPlatformConfig().passwordSecret
        })
        
        const checkUserPasswordRes = passwordUtils.checkUserPassword({
            password
        })
        
        console.log('checkUserPasswordRes', checkUserPasswordRes);
        
        return checkUserPasswordRes
    }
}
```

### common 模块, 对应 uni-id-co 的 common 模块 
```javascript
const { common } = require('x-uni-id-co');

const constants = common.constants;

const error = common.error;

const cipher = common['sensitive-aes-cipher'];

const universal = common.universal;

const utils = common.utils;

const validator = common.validator;
```

### config 模块, 对应 uni-id-co 的 config 模块 
```javascript
const { config } = require('x-uni-id-co');
```

### lang 模块, 对应 uni-id-co 的 lang 模块 
```javascript
const { lang } = require('x-uni-id-co');
```

### lib 模块, 对应 uni-id-co 的 lib 模块 
```javascript
const { lib } = require('x-uni-id-co');
```

### middleware 模块, 对应 uni-id-co 的 middleware 模块 
```javascript
const { middleware } = require('x-uni-id-co');
```



#### 本插件未经过全面测试, 有问题请在交流群反馈
