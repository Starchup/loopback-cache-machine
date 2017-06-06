module.exports = function (app)
{
    var self = this;

    if (app) app.post('/cache/receive', function (req, res)
    {
        if (!req.body)
        {
            res.status(400).send('body is required');
        }
        else if (!req.body.modelName)
        {
            res.status(400).send('modelName is required');
        }
        else if (!req.body.methodName)
        {
            res.status(400).send('methodName is required');
        }
        else if (!req.body.data)
        {
            res.status(400).send('data is required');
        }
        else if (!req.body.data.id)
        {
            res.status(400).send('model id is required in data');
        }
        else
        {
            var localData = self[req.body.modelName];
            if (localData) localData[req.body.data.id] = req.body.data;
            res.status(200).send();
        }
    });

    self.watchModel = function (modelName)
    {
        if (!self[modelName]) self[modelName] = {};
    }

    return self;
}
