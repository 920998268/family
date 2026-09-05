const uniIdCo = require('./index.obj.js')

// 通过云对象 this 获取 getCustomProperties(云对象 this)
const cloudobjectProperties = ["__internalObject", "getMethodName", "getUniIdToken", "getParams", "getHttpInfo", "getClientInfo", "getCloudInfo", "getUniCloudRequestId"]

function getCustomProperties(obj) {
    const props = new Set();
    const excludeProps = new Set(Object.getOwnPropertyNames(Object.prototype));

    do {
        const ownProps = Object.getOwnPropertyNames(obj);
        ownProps.forEach(p => {
            if (!excludeProps.has(p)) {
                props.add(p);
            }
        });
    } while ((obj = Object.getPrototypeOf(obj)) && obj !== Object.prototype);

    return [...props];
}

function getUniIdCo(context, type = 'function') {

    return new Proxy(uniIdCo, {

        get(target, prop, receiver) {

            if (cloudobjectProperties.includes(prop)) {
                return function(...args) {
                    return context[prop](...args)
                }
            }

            if (typeof target[prop] === 'function' && !['_before', '_after'].includes(prop)) {

                return async function(...args) {
                    let res
                    let err

                    try {
                        if (type == 'function') {
                            context.methodName = prop
                        } else {
                            context.__internalObject.methodName = prop
                            context.__internalObject.event.method = prop
                            context.__internalObject.params = args
                            context.__internalObject.event.params = args
                        }

                        await uniIdCo._before.call(context)

                        res = await target[prop].call(context, ...args)

                    } catch (error) {

                        err = error

                    }

                    return uniIdCo._after.call(context, err, res || {})
                }
            }

            return target[prop];
        }
    });
}

function cloudfunction(context, event) {
    const uniIdCoContext = {}

    uniIdCoContext.getClientInfo = function() {
        const clientInfo = {}

        for (const key of Object.keys(context)) {
            if (typeof context[key] != 'object' && typeof context[key] != 'function') clientInfo[key] = context[key]
        }

        clientInfo.clientIP = context.CLIENTIP
        clientInfo.userAgent = context.CLIENTUA
        clientInfo.source = context.SOURCE
        clientInfo.os = context.OS
        clientInfo.platform = context.PLATFORM


        return clientInfo
    }

    uniIdCoContext.getCloudInfo = function() {
        const { ...cloudInfo } = context.SPACEINFO

        cloudInfo.functionName = context.FUNCTION_NAME
        // cloudInfo.functionType = context.FUNCTION_TYPE
        cloudInfo.functionType = 'cloudobject'
        cloudInfo.runtimeEnv = context.RUNTIME_ENV

        return cloudInfo
    }

    uniIdCoContext.getUniIdToken = function() {
        return context.uniIdToken || event.uniIdToken
    }

    uniIdCoContext.getMethodName = function() {
        return uniIdCoContext.methodName || context.FUNCTION_NAME
    }

    uniIdCoContext.getParams = function() {
        return [event.data]
    }

    uniIdCoContext.getUniCloudRequestId = function() {
        return context.requestId
    }

    uniIdCoContext.getHttpInfo = function() {
        return event
    }

    return getUniIdCo(uniIdCoContext, 'function')
}

function cloudobject(context) {
    const uniIdCoContext = {}

    cloudobjectProperties.forEach(key => {

        if (typeof context[key] == 'function') {
            uniIdCoContext[key] = context[key].bind(uniIdCoContext)
        }

        if (key == '__internalObject') {
            uniIdCoContext[key] = JSON.parse(JSON.stringify(context[key]))
        }
    })

    return getUniIdCo(uniIdCoContext, 'object')
}

module.exports = {
    cloudfunction,
    cloudobject
}