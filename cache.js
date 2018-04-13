"use strict";

const PubSub = require('@google-cloud/pubsub');
const cacheList = {};

module.exports = function (app, options)
{
    if (!process.env.NODE_ENV) throw new Error('process.env.NODE_ENV is a required env var');
    if (!options || !options.serviceName) throw new Error('options.serviceName is required');
    const name = options.serviceName;

    if (!cacheList[name])
    {
        cacheList[name] = Cache.call(
        {}, app, options);
    }
    else if (options.type)
    {
        cacheList[name] = Cache.call(cacheList[name], app, options);
    }
    return cacheList[name];
}



/**
 * Creates the cache machine
 * 
 * @param {object} app - Loopback app object.
 * @param {object} options - Configuration options.
 * @param {string} options.serviceName - Name of cache, used to access correct cache when reading.
 * @param {string} options.type - Cache machine type.  May be server/client/local. Inclusion triggers init.
 * @param {string} options.projectId - Google Cloud Project Id.  Required for server/client.
 * @param {object[]} [options.modelsToWatch] - Models to watch and cache.  Used when options.type is client.
 * @param {function[]} [filters] - Array of functions taking modelsName, method, instance and ctx. Return false to block publishing on server
 * @param {function} [options.onReady] - Callback function called when cache is primed with data (client/local) or ready to publish (server). Success response is true for server side, and cached data for client/local.
 * @param {object} [options.eventConfig] - Event configuration object.  Used when options.type is client.
 * @param {array} [options.eventConfig.events] - Array of events to react to, in form "Model.method".
 * @param {function} [options.eventConfig.eventFn] - Function to call when any event is triggered.
 */
function Cache(app, options)
{
    const self = this;

    self.pubsub = PubSub(
    {
        projectId: options.projectId
    });

    self.cached = {};

    self.findObj = function (modelName, key, value)
    {
        if (!self.cached[modelName]) return;

        return Object.keys(self.cached[modelName]).map(k =>
        {
            return self.cached[modelName][k];
        }).find(obj =>
        {
            return obj[key] === value;
        });
    }

    self.findObjs = function (modelName, key, value)
    {
        if (!self.cached[modelName]) return [];

        return Object.keys(self.cached[modelName]).map(k =>
        {
            return self.cached[modelName][k];
        }).filter(obj =>
        {
            return obj[key] === value;
        });
    }

    self.complexFindObjs = function (modelName, filterFunction)
    {
        if (!self.cached[modelName]) return [];
        return Object.keys(self.cached[modelName]).map(k => self.cached[modelName][k]).filter(filterFunction);
    }

    self.watchModels = function (modelsToWatch)
    {
        modelsToWatch = modelsToWatch || [];
        const target = {};
        modelsToWatch.forEach(m =>
        {
            if (!m || !m.modelName) throw new Error('Modelname is required for watching models');

            self.cached[m.modelName] = {};

            const fields = m.fields || [];

            target[m.modelName] = {
                modelName: m.modelName,
                fields: fields
            };
        });
        return target;
    }


    if (options && !options.serviceName) throw new Error('options.serviceName is required');
    self.serviceName = options.serviceName;

    if (options && options.filters)
    {
        if (getType(options.filters) !== 'Array') throw new Error('options.filters must be an array of functions');
        self.filters = options.filters;
    }

    if (options && options.onReady)
    {
        if (getType(options.onReady) !== 'Function') throw new Error('options.onReady must be a function');
        self.onReady = options.onReady;
    }
    self.type = options.type;

    if (options && options.type === 'client') clientSide(self, options);
    else if (options && options.type === 'server') serverSide(self, app, options);
    else if (options && options.type === 'local') localSide(self, app, options);
    else if (options && options.type)
    {
        throw new Error('Type "' + options.type + '"" is not valid. Valid options: client/server/local');
    }

    return self;
}


/* Pubsub Setup */
const sep = '__';

function makeTopicName(topicName)
{
    return topicName + sep + process.env.NODE_ENV;
}

/*
 * Creates a subscription name with the following format:
 * serviceName-environment-timestamp-randomNumber, truncated at 255 chars
 */
function makeUniqueSubName(serviceName, topicName)
{
    //Google name length limit
    const limit = 255;
    const timestamp = 't' + Date.now().toString();
    let subName = [serviceName, topicName, process.env.NODE_ENV, timestamp].join('-');
    if (subName.length > limit) subName = subName.substring(0, limit);
    return subName;
}

function createTopic(pubsub, topicName, topicOptions)
{
    topicName = makeTopicName(topicName);
    const topic = pubsub.topic(topicName);

    //Find-or-create
    topicOptions = topicOptions ||
    {
        autoCreate: true
    };

    //Find or create topic
    return topic.get(topicOptions).then(topics =>
    {
        //Google return format, always first index in array
        return topics[0];
    });
}

//Finds/creates a topic and registers a subscriber to that topic
function registerSubscription(cache, pubsub, topicName, subName, onMessage, onError)
{
    //Find-or-create
    const topicOptions = {
        autoCreate: true
    };

    //Find or create topic
    return createTopic(pubsub, topicName, topicOptions).then(topic =>
    {
        const subscriptionName = subName ? subName + sep + process.env.NODE_ENV : makeUniqueSubName(cache.serviceName, topicName);
        return topic.createSubscription(subscriptionName).then(subscriptions =>
        {
            //Google return format, always first index in array
            const subscription = subscriptions[0];

            //Bind default event handlers with helpful contextual params
            const messageHandler = onMessage || defaultMessageHandler.bind(null, topic, subscription, cache);
            const errorHandler = onError || defaultErrorHandler.bind(null, topic, subscription);

            //Handlers will receive message object as param
            subscription.on('message', messageHandler);
            subscription.on('error', errorHandler);
        }).catch(console.error);
    });
}

//Parses existing pubsub topics for models to always watch
function getExistingModelsWatched(pubsub)
{
    const topicNameRegex = /.*topics\/([a-zA-Z\-]*).*/;
    return pubsub.getTopics().then(topics =>
    {
        if (!topics || !topics.length) topics = [];
        //Google response format
        topics = topics[0];
        const usedTopics = {};

        //Unique list of model names from subscriptions
        return topics.reduce((list, t) =>
        {
            if (!t.name || t.name.indexOf(process.env.NODE_ENV) < 0) return list;
            const name = t.name.replace(topicNameRegex, '$1');

            if (usedTopics.hasOwnProperty(name)) return list;

            usedTopics[name] = true;
            list.push(name);
            return list;
        }, []);
    });
}


/* Pubsub Handlers */

//Saves data to cache, and checks if it's a registered event
function defaultMessageHandler(topic, subscription, cache, message)
{
    const data = JSON.parse(message.data.toString('utf8'));

    receiveCacheData(cache, data);
    handleEvent(cache, data);

    message.ack();
}

//Saves data to cache, does not check for events
function createCache(cache, message)
{
    const data = JSON.parse(message.data.toString('utf8'));

    receiveCacheData(cache, data);
    if (cache.onReady) cache.onReady(null, cache.cached);

    message.ack();
}

//On cache creation request, find the data, record which models to watch, and send
function primeCache(cache, app, message)
{
    let dataToPublish = [];

    const data = JSON.parse(message.data.toString('utf8'));
    const responseSubName = data.responseSubName;

    getCacheData(app, cache, data.models).then(res =>
    {
        res.forEach(d =>
        {
            dataToPublish = dataToPublish.concat(d.data.map(datum =>
            {
                return {
                    modelName: d.modelName,
                    methodName: 'prime',
                    modelId: datum.id,
                    data: datum
                };
            }));
        });
        return createTopic(cache.pubsub, responseSubName);
    }).then(topic =>
    {
        topic.publisher().publish(Buffer.from(JSON.stringify(dataToPublish)), publishCb);
    });

    message.ack();
}

function defaultErrorHandler(topic, subscription, err)
{
    console.error('Error for topic ' + topic.name + ' and subscription ' + subscription.name);
    console.error(err);
}

/* Pubsub Handler helpers */

//Check event list and send data to event handler/router
function handleEvent(cache, data)
{
    if (cache.eventList && data) data.forEach(d =>
    {
        const modelEvent = `${d.modelName}.${d.methodName}`;
        if (!cache.eventList[modelEvent]) return;

        cache.eventFn(d.modelName, d.methodName, d.modelId, d.data, (err, res) =>
        {
            if (err)
            {
                if (cache.eventFnErrorHandler) cache.eventFnErrorHandler(err);
                else console.error(err);
            }
        });
    });
}

//Receive individual model update data
function receiveCacheData(cache, data)
{
    if (data) data.forEach(d =>
    {
        const modelId = d.data && d.data.id ? d.data.id : d.modelId;

        let errorMsg;
        if (!d) errorMsg = 'message data is required';
        else if (!d.modelId) errorMsg = 'model id is required';
        else if (!d.modelName) errorMsg = 'modelName is required';
        else if (!d.methodName) errorMsg = 'methodName is required';
        else if (d.methodName !== 'delete' && !d.data) errorMsg = 'data is required';

        if (errorMsg) return console.error(`${errorMsg} ${JSON.stringify(d)}`);

        const localData = cache.cached[d.modelName];
        if (!localData) return;

        if (d.methodName === 'update')
        {
            localData[modelId] = d.data;
        }
        else if (d.methodName === 'prime')
        {
            if (!localData[modelId] || !localData[modelId].id) localData[modelId] = d.data;
        }
        else if (d.methodName === 'create')
        {
            if (!localData[modelId] || !localData[modelId].id) localData[modelId] = d.data;
        }
        else if (d.methodName === 'delete')
        {
            if (d.modelId) delete localData[d.modelId];
        }
    });
}

function publishCb(err, res)
{
    if (err) console.error(err);
}

/* Model Hook helpers */
function shouldPublish(cache, modelName, methodName, instance, ctx)
{
    if (!cache.filters || !cache.filters.length) return true;
    return cache.filters.every(fn =>
    {
        //Silently skip improper filters
        if (getType(fn) !== 'Function') return true;
        return fn(modelName, methodName, instance, ctx);
    });
}

//Returns a function that watches model crection changes and publishes them
function afterSaveHook(cache)
{
    return function (ctx, next)
    {
        // Clone the instance or fallback to the data
        let instance = null;
        if (ctx.instance) instance = JSON.parse(JSON.stringify(ctx.instance));
        else if (ctx.data) instance = JSON.parse(JSON.stringify(ctx.data));
        else return next();

        // Get the instance Id
        let modelId;
        if (instance.id) modelId = instance.id;
        else if (ctx.where && ctx.where.id) modelId = ctx.where.id;
        if (!modelId) return next();

        const modelName = getModelName(ctx);
        if (!modelName) return next();

        const method = ctx.isNewInstance ? 'create' : 'update';
        const topicName = modelName;

        if (!shouldPublish(cache, modelName, method, instance, ctx)) return next();

        Promise.resolve().then(() =>
        {
            if (typeof modelId === 'number') return cache.emit([
            {
                modelName: modelName,
                methodName: method,
                modelId: modelId,
                data: instance
            }], topicName);

            if (modelId.inq && Array.isArray(modelId.inq))
            {
                const data = modelId.inq.filter(id =>
                {
                    return typeof id === 'number';
                }).map(id =>
                {
                    return {
                        modelName: modelName,
                        methodName: method,
                        modelId: id,
                        data: instance
                    };
                });
                return cache.emit(data, topicName);
            }

        }).then(() =>
        {
            next();
        }).catch(next);
    }
}

//Returns a function that watches model deletions and publishes them
function beforeDeleteHook(cache, app)
{
    return function (ctx, next)
    {
        const modelName = getModelName(ctx);
        if (!modelName) return next();

        const Model = app.models[modelName];
        const methodName = 'delete';
        const topicName = modelName;

        Model.find(
        {
            where: ctx.where
        }).then(models =>
        {
            if (!models || models.length < 1) return;

            const data = JSON.parse(JSON.stringify(models)).filter(m =>
            {
                return shouldPublish(cache, modelName, methodName, m, ctx);
            }).map(m =>
            {
                return {
                    modelName: modelName,
                    methodName: methodName,
                    modelId: m.id
                }
            });

            return cache.emit(data, topicName);
        }).catch(console.error).then(next);
    }
}


/* Cache helpers*/

//Query db for requested data
function getCacheData(app, cache, data)
{
    var res = [];

    return Object.keys(data).reduce((prev, modelName) =>
    {
        return prev.then(() =>
        {
            //Apply publishing hooks to relevant models
            if (cache.modelsWatched.indexOf(modelName) < 0) setModelsWatched(app, cache, [modelName]);

            //Only prime the cache if the type is cache or left blank (eg: `event`)
            if (data[modelName].type && data[modelName].type !== 'cache') return;

            return app.models[modelName].find(
            {
                fields: data[modelName].fields || []
            }).then(modelData =>
            {
                res.push(
                {
                    modelName: modelName,
                    data: modelData
                });
            });
        });
    }, Promise.resolve()).then(() =>
    {
        return res;
    });
}

//Apply hook handlers to watched models
function setModelsWatched(app, cache, models)
{
    if (models) models.forEach(m =>
    {
        const Model = app.models[m];
        if (!m || !Model) return;

        cache.modelsWatched.push(m);

        Model.observe('after save', afterSaveHook(cache));
        Model.observe('before delete', beforeDeleteHook(cache, app));
    });
}


/* General helpers */

function getModelName(ctx)
{
    return ctx.Model && ctx.Model.definition && ctx.Model.definition.name;
}

function getType(val)
{
    return Object.prototype.toString.call(val).slice(8, -1);
}



/* Cache Machine types */

/**
 * Client side listening
 */
function clientSide(cache, options)
{
    if (!options.projectId)
    {
        throw new Error('Google Project Id is required for cache client');
    }
    if (options.eventConfig && options.eventConfig.events && !options.eventConfig.eventFn)
    {
        throw new Error('options.eventConfig.eventFn is required if including events');
    }

    cache.modelsToWatch = cache.watchModels(options.modelsToWatch);

    //On boot, prime the cache by creating subs and a request message to the cache publisher
    let modelsToNotify = {};
    let subs = [];

    if (cache.modelsToWatch && Object.keys(cache.modelsToWatch).length)
    {
        //Add cache models to sub list
        Object.keys(cache.modelsToWatch).forEach(modelName =>
        {
            modelsToNotify[modelName] = {
                modelName: modelName,
                type: 'cache'
            };
            subs.push(
            {
                topicName: modelName
            });
        });
    }

    //Set up event related behavior
    if (options.eventConfig && options.eventConfig.events)
    {
        cache.eventFn = options.eventConfig.eventFn;
        cache.eventFnErrorHandler = options.eventConfig.eventFnErrorHandler
        cache.eventList = {};
        //Save events in quick dictionary and add to sub list
        options.eventConfig.events.forEach(event =>
        {
            cache.eventList[event] = true;

            //Add to list of models to notify server side of
            const eventCmps = event.split('.');
            const topicName = eventCmps[0];
            const methodName = eventCmps[1];

            modelsToNotify[eventCmps[0]] = {
                modelName: topicName,
                type: 'event'
            };

            const sub = {
                topicName: topicName,
                subName: options.serviceName + sep + topicName
            };

            subs.push(sub);
        });
    }

    const responseSubName = makeUniqueSubName(cache.serviceName, 'create-cache');

    //Register model-based subscriptions (cache-update and event)
    return subs.reduce((prev, s) =>
    {
        return prev.then(() =>
        {
            return registerSubscription(cache, cache.pubsub, s.topicName, s.subName);
        });
    }, Promise.resolve()).then(() =>
    {
        //Bind cache as first param
        const cacheHandler = createCache.bind(null, cache);

        //Register a special subscription for cache creation
        return registerSubscription(cache, cache.pubsub, responseSubName, null, cacheHandler);
    }).then(() =>
    {
        //Notify publishers of client start
        return createTopic(cache.pubsub, 'start-cache-client');
    }).then(topic =>
    {
        topic.publisher().publish(Buffer.from(JSON.stringify(
        {
            responseSubName: responseSubName,
            models: modelsToNotify
        })), publishCb);
    }).catch(e =>
    {
        if (cache.onReady) return cache.onReady(e);
        else throw e;
    });
}

/**
 * Server side broadcasting
 */
function serverSide(cache, app, options)
{
    if (!app) throw new Error('app is required for cache server');
    if (!options.projectId) throw new Error('Google Project Id is required for cache server');

    cache.modelsWatched = [];

    //Find models to watch based on existing pub/sub topics
    getExistingModelsWatched(cache.pubsub).then(models =>
    {
        setModelsWatched(app, cache, models);

        //Bind cache and app as params
        const msgHandler = primeCache.bind(null, cache, app);

        //Listen for cache creation requests, find data and publish back
        registerSubscription(cache, cache.pubsub, 'start-cache-client', null, msgHandler).then((res) =>
        {
            if (cache.onReady) cache.onReady(null, true);
        });
    }).catch(e =>
    {
        if (cache.onReady) return cache.onReady(e);
        else throw e;
    });

    //Cache-type specific emitter/publisher
    cache.emit = function (data, topicName)
    {
        if (!topicName) throw new Error('Publishing message requires topic name');
        return createTopic(cache.pubsub, topicName).then(topic =>
        {
            return topic.publisher().publish(Buffer.from(JSON.stringify(data)), publishCb);
        });
    }
}

/**
 * True local (no pubsub) broadcasting
 */
function localSide(cache, app, options)
{
    if (!app) throw new Error('app is required for cache server');

    //Cache-type specific emitter/publisher
    cache.emit = function (data)
    {
        const localData = cache.cached[data.modelName];
        const modelId = data.data && data.data.id ? data.data.id : data.modelId;

        // If there is not even an empty dictionary for this modelName
        // if means this cache is not listening for the model, so only
        // add the data if we actually care about it
        if (data.data && localData) localData[modelId] = data.data;

        // If there is no data, it means it's a deletion
        else if (data.modelId && data.methodName === 'delete') delete localData[data.modelId];
        return Promise.resolve();
    }

    cache.modelsWatched = [];
    cache.modelsToWatch = cache.watchModels(options.modelsToWatch);

    //On boot, prime the cache
    if (cache.modelsToWatch && Object.keys(cache.modelsToWatch).length)
    {
        return getCacheData(app, cache, cache.modelsToWatch).then(res =>
        {
            res.forEach(d =>
            {
                const localData = cache.cached[d.modelName];
                if (!localData || !d.data) return;

                d.data.forEach(datum =>
                {
                    localData[datum.id] = datum;
                });
            });
            if (cache.onReady) cache.onReady(null, cache.cached);
        }).catch(e =>
        {
            if (cache.onReady) return cache.onReady(e);
            else throw e;
        });
    }
}