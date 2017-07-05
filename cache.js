var bodyParser = require('body-parser');

module.exports = function (app, options)
{
    var self = this;

    if (app) app.use(bodyParser.json());

    if (options && options.type === 'client') clientSide(self, app, options);
    else if (options && options.type === 'server') serverSide(self, app, options);
    else if (options && options.type)
    {
        throw new Error('Type "' + options.type + '"" is not valid. Use "server" or "client"');
    }

    self.findObj = function (modelName, key, value)
    {
        return Object.keys(self[modelName]).map(function (k)
        {
            return self[modelName][k];
        }).find(function (obj)
        {
            return obj[key] === value;
        });
    }

    self.watchModel = function (modelName)
    {
        if (self[modelName]) return;

        self[modelName] = {};

        return self.broadcasters.reduce(function (prev, curr, idx)
        {
            return prev.then(function ()
            {
                return self.ask(curr,
                {
                    model: modelName
                }).then(function (res)
                {
                    self[modelName] = res;
                }).catch(console.error);
            });
        }, Promise.resolve());
    }

    self.broadcastModels = function (modelName)
    {
        app.models[modelName].observe('after save', self.hook);
        app.models[modelName].observe('before delete', self.deleteHook);
    }

    return self;
}


/**
 * Client side listening
 */
function clientSide(cache, app, options)
{
    if (!app) throw new Error('app is required for cache client');
    if (!options.broadcasters) throw new Error('broadcasters are required for cache client');
    if (!options.ask) throw new Error('ask function is required for cache client');

    cache.broadcasters = options.broadcasters.map(function (r)
    {
        return r + '/cache/broadcaster';
    });
    cache.ask = options.ask;

    app.post('/cache/receiver', function (req, res)
    {
        var errorMsg;

        if (!req.body) errorMsg = 'body is required';
        else if (!req.body.modelName) errorMsg = 'modelName is required';
        else if (!req.body.methodName) errorMsg = 'methodName is required';
        else if (req.body.methodName === 'create' && !req.body.data) errorMsg = 'data is required for create';
        else if (req.body.methodName === 'update' && !req.body.data) errorMsg = 'data is required for update';
        else if (req.body.methodName === 'create' && !req.body.data.id) errorMsg = 'model id is required for create';
        else if (req.body.methodName === 'update' && !req.body.data.id) errorMsg = 'model id is required for update';
        else if (req.body.methodName === 'delete' && !req.body.modelId) errorMsg = 'modelId is required for deletion';

        if (errorMsg) res.status(400).send(errorMsg);
        else
        {
            var localData = cache[req.body.modelName];

            // If there is not even an empty dictionary for this modelName
            // if means this cache is not listening for the model, so only
            // add the data if we actually care about it
            if (req.body.data && localData) localData[req.body.data.id] = req.body.data;

            // If there is no data, it means it's a deletion
            else if (req.body.modelId && req.body.methodName === 'delete') delete localData[req.body.modelId];

            res.status(200).send();
        }
    });
}


/**
 * Server side broadcasting
 */
function serverSide(cache, app, options)
{
    if (!app) throw new Error('app is required for cache server');
    if (!options.receivers) throw new Error('receivers are required for cache server');
    if (!options.send) throw new Error('send function is required for cache server');

    cache.receivers = options.receivers.map(function (r)
    {
        return r + '/cache/receiver';
    });
    cache.send = options.send;

    app.post('/cache/broadcaster', function (req, res)
    {
        var errorMsg;

        if (!req.body) errorMsg = 'body is required';
        if (!req.body.model) errorMsg = 'model name is required';

        if (errorMsg) res.status(400).send(errorMsg);
        else
        {
            var Model = app.models[req.body.model];
            if (!Model) return res.status(400).send('No model found with name ' + req.body.model);

            Model.find().then(function (data)
            {
                res.status(200).send(data);
            });
        }
    });

    //Formats data and calls Master Hooker
    cache.hook = function (ctx, next)
    {
        // Clone the instance or fallback to the data
        var instance = null;
        if (ctx.instance) instance = JSON.parse(JSON.stringify(ctx.instance));
        else if (ctx.data) instance = JSON.parse(JSON.stringify(ctx.data));
        else return next();

        // Get the instance Id
        var modelId;
        if (instance.id) modelId = instance.id;
        else if (ctx.where && ctx.where.id) modelId = ctx.where.id;
        if (!modelId) return next();

        var modelName = getModelName(ctx);
        if (!modelName) return next();

        var method = ctx.isNewInstance ? 'create' : 'update';

        Promise.resolve().then(function ()
        {
            if (typeof modelId !== 'number')
            {
                if (modelId.inq && Array.isArray(modelId.inq))
                {
                    modelId.inq.forEach(function (id)
                    {
                        if (typeof id === 'number') return cache.emit(
                        {
                            modelName: modelName,
                            methodName: method,
                            modelId: id,
                            data: instance
                        });
                    });
                }
            }
            else return cache.emit(
            {
                modelName: modelName,
                methodName: method,
                modelId: modelId,
                data: instance
            });

        }).then(function ()
        {
            next();
        }).catch(next);
    }

    //Formats data and calls Master Hooker
    cache.deleteHook = function (ctx, next)
    {
        var modelName = getModelName(ctx);
        if (!modelName) return next();

        var Model = app.models[modelName];

        Model.find(
        {
            where: ctx.where
        }).then(function (models)
        {
            if (!models || models.length < 1) return;

            return models.reduce(function (prev, curr, idx)
            {
                return prev.then(function ()
                {
                    return cache.emit(
                    {
                        modelName: modelName,
                        methodName: 'delete',
                        modelId: curr.id
                    }).catch(console.error);
                });
            }, Promise.resolve());
        }).catch(console.error).then(next);
    }

    cache.emit = function (data)
    {
        return cache.receivers.reduce(function (prev, curr, idx)
        {
            return prev.then(function ()
            {
                return cache.send(curr, data).catch(console.error);
            });
        }, Promise.resolve());
    }
}

function getModelName(ctx)
{
    return ctx.Model && ctx.Model.definition && ctx.Model.definition.name;
}
