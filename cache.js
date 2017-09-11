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

    if (options && options.type === 'client') clientSide(self, options);
    else if (options && options.type === 'server') serverSide(self, app, options);
    else if (options && options.type === 'local') localSide(self, app, options);
    else if (options && options.type)
    {
        throw new Error('Type "' + options.type + '"" is not valid. Valid options: client/server/local');
    }

    if (options && options.filters)
    {
        if (getType(options.filters) !== 'Array') throw new Error('options.filters must be an array of functions');
        self.filters = options.filters;
    }
    self.type = options.type;
    return self;
}


/* Pubsub Setup */
const sep = '__';

function makeTopicName(topicName)
{
    return topicName + sep + process.env.NODE_ENV;
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

    //Allows us to not have to worry about remembering to acknowledge each message
    const subscribeOptions = {
        autoAck: true
    };

    //Find or create topic
    return createTopic(pubsub, topicName, topicOptions).then(topic =>
    {
        const subscriptionName = subName ? subName + sep + process.env.NODE_ENV : null;
        return topic.subscribe(subscriptionName, subscribeOptions).then(subscriptions =>
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
    let data = getType(message.data) === 'String' ? JSON.parse(message.data) : data;
    if (getType(data) !== 'Array') data = [data];
    receiveCacheData(cache, data);
    handleEvent(cache, data);
}

//Saves data to cache, does not check for events
function createCache(cache, message)
{
    let data = getType(message.data) === 'String' ? JSON.parse(message.data) : data;
    if (getType(data) !== 'Array') data = [data];
    receiveCacheData(cache, data);
}

//On cache creation request, find the data, record which models to watch, and send
function primeCache(cache, app, message)
{
    const data = message.data;
    let dataToPublish = [];

    getCacheData(app, cache, data).then(res =>
    {
        res.forEach(d =>
        {
            const dataToAdd = d.data.map(datum =>
            {
                return {
                    modelName: d.modelName,
                    methodName: 'update',
                    modelId: datum.id,
                    data: datum
                };
            });
            dataToPublish = dataToPublish.concat(dataToAdd);
        });
        return createTopic(cache.pubsub, 'create-cache');
    }).then(topic =>
    {
        topic.publish(JSON.stringify(dataToPublish), publishCb);
    });
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
    if (!cache.eventList) return;
    data.forEach(d =>
    {
        const modelEvent = `${d.modelName}.${d.methodName}`;
        if (cache.eventList[modelEvent])
        {
            cache.eventFn(d.modelName, d.methodName, d.modelId, d.data, (err, res) =>
            {
                if (err)
                {
                    if (cache.eventFnErrorHandler) cache.eventFnErrorHandler(err);
                    else console.error(err);
                }
            });
        }
    });
}

//Receive individual model update data
function receiveCacheData(cache, data)
{
    let errorMsg;
    data.forEach(d =>
    {
        const modelId = d.data && d.data.id ? d.data.id : d.modelId;

        if (!d) errorMsg = 'message data is required';
        else if (!d.modelName) errorMsg = 'modelName is required';
        else if (!d.methodName) errorMsg = 'methodName is required';
        else if (d.methodName === 'create' && !d.data) errorMsg = 'data is required for create';
        else if (d.methodName === 'update' && !d.data) errorMsg = 'data is required for update';
        else if (d.methodName === 'create' && !modelId) errorMsg = 'model id is required for create';
        else if (d.methodName === 'update' && !modelId) errorMsg = 'model id is required for update';
        else if (d.methodName === 'delete' && !modelId) errorMsg = 'model id is required for deletion';

        if (errorMsg) return console.error(`${errorMsg} ${JSON.stringify(d)}`);
        else
        {
            const localData = cache.cached[d.modelName];

            // If there is not even an empty dictionary for this modelName
            // if means this cache is not listening for the model, so only
            // add the data if we actually care about it
            if (d.data && localData) localData[modelId] = d.data;

            // If there is no data, it means it's a deletion
            else if (d.modelId && d.methodName === 'delete') delete localData[d.modelId];
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
        const topicName = [modelName, method].join(sep);

        if (!shouldPublish(cache, modelName, method, instance, ctx)) return next();

        Promise.resolve().then(() =>
        {
            if (typeof modelId !== 'number')
            {
                if (modelId.inq && Array.isArray(modelId.inq))
                {
                    modelId.inq.forEach(id =>
                    {
                        if (typeof id === 'number') return cache.emit(
                        {
                            modelName: modelName,
                            methodName: method,
                            modelId: id,
                            data: instance
                        }, topicName);
                    });
                }
            }
            else return cache.emit(
            {
                modelName: modelName,
                methodName: method,
                modelId: modelId,
                data: instance
            }, topicName);
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
        const topicName = [modelName, methodName].join(sep);


        Model.find(
        {
            where: ctx.where
        }).then(models =>
        {
            if (!models || models.length < 1) return;
            return JSON.parse(JSON.stringify(models)).reduce((prev, curr, idx) =>
            {
                return prev.then(() =>
                {
                    if (!shouldPublish(cache, modelName, methodName, curr, ctx)) return Promise.resolve();

                    return cache.emit(
                    {
                        modelName: modelName,
                        methodName: methodName,
                        modelId: curr.id
                    }, topicName).catch(console.error);
                });
            }, Promise.resolve());
        }).catch(console.error).then(next);
    }
}


/* Cache helpers*/

//Query db for requested data
function getCacheData(app, cache, data)
{
    const dbProms = [];
    for (let modelName in data)
    {
        //Apply publishing hooks to relevant models
        const Model = app.models[modelName];
        if (cache.modelsWatched.indexOf(modelName) < 0) setModelsWatched(app, cache, [modelName]);

        if (data[modelName].type && data[modelName].type !== 'cache') continue;

        //Only prime the cache if the type is cache or left blank
        const query = {};
        if (data[modelName].fields && data[modelName].fields.length) query.fields = data[modelName].fields;
        const prom = Model.find(query).then(modelData =>
        {
            return {
                modelName: modelName,
                data: modelData
            };
        });
        dbProms.push(prom);
    }
    return Promise.all(dbProms);
}

//Apply hook handlers to watched models
function setModelsWatched(app, cache, models)
{
    if (!models || !models.length) return;
    models.forEach(m =>
    {
        const Model = app.models[m];
        if (!Model) return;

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
    if (!options.projectId) throw new Error('Google Project Id is required for cache client');
    if (options.eventConfig && options.eventConfig.events && !options.eventConfig.eventFn) throw new Error('options.eventConfig.eventFn is required if including events');

    let modelsToNotify = {};

    cache.modelsToWatch = {};
    cache.modelsToWatch = cache.watchModels(options.modelsToWatch);

    //On boot, prime the cache by creating subs and a request message to the cache publisher
    let subs = [];
    if (cache.modelsToWatch && Object.keys(cache.modelsToWatch).length)
    {
        modelsToNotify = JSON.parse(JSON.stringify(cache.modelsToWatch));

        //Add cache models to sub list
        subs = subs.concat(Object.keys(cache.modelsToWatch).map(m =>
        {
            return {
                topicName: m + sep + 'update',
            };
        }));
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
            modelsToNotify[eventCmps[0]] = {
                modelName: eventCmps[0],
                type: 'event'
            };

            const topicName = event.replace('.', sep);
            const sub = {
                topicName: topicName,
                subName: options.serviceName + sep + topicName
            };
            subs.push(sub);
        });
    }

    const subPromises = subs.map(s =>
    {
        registerSubscription(cache, cache.pubsub, s.topicName, s.subName);
    });

    //Register model-based subscriptions (cache-update and event)
    return Promise.all(subPromises).then(() =>
    {
        //Bind cache as first param
        const cacheHandler = createCache.bind(null, cache);

        //Register a special subscription for cache creation
        return registerSubscription(cache, cache.pubsub, 'create-cache', null, cacheHandler);
    }).then(() =>
    {
        //Notify publishers of client start
        return createTopic(cache.pubsub, 'start-cache-client');
    }).then(topic =>
    {
        topic.publish(modelsToNotify, publishCb);
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
        registerSubscription(cache, cache.pubsub, 'start-cache-client', null, msgHandler);
    });

    //Cache-type specific emitter/publisher
    cache.emit = function (data, topicName)
    {
        if (!topicName) throw new Error('Publishing message requires topic name');
        return createTopic(cache.pubsub, topicName).then(topic =>
        {
            topic.publish(JSON.stringify(data), publishCb);
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
        getCacheData(app, cache, cache.modelsToWatch).then(res =>
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
        });
    }
}