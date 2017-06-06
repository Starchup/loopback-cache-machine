module.exports = function (app)
{
    var self = this;

    if (app) app.post('/cache/receive', function (req, res)
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
            var localData = self[req.body.modelName];

            // If there is not even an empty dictionary for this modelName
            // if means this cache is not listening for the model, so only
            // add the data if we actually care about it
            if (req.body.data && localData) localData[req.body.data.id] = req.body.data;

            // If there is no data, it means it's a deletion
            else if (req.body.modelId && req.body.methodName === 'delete') delete localData[req.body.modelId];

            res.status(200).send();
        }
    });

    self.watchModel = function (modelName)
    {
        if (!self[modelName]) self[modelName] = {};
    }

    return self;
}
