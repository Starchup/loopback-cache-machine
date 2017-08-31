module.exports = function startCache(app)
{
    if (process.env.NODE_ENV !== 'testing')
    {
        // Server
        var cacheServer = require('../../cache.js')(app,
        {
            type: 'server',
            serviceName: 'test-server',
            projectId: process.env.GCLOUD_PROJECT_TEST
        });

        // Client
        var cacheClient = require('../../cache.js')(app,
        {
            type: 'client',
            serviceName: 'test',
            projectId: process.env.GCLOUD_PROJECT_TEST,
            modelsToWatch: [
            {
                modelName: 'Customer'
            }],
        });
    }
    else
    {
        var cacheLocal = require('../../cache.js')(app,
        {
            type: 'local',
            serviceName: 'test',
            modelsToWatch: [
            {
                modelName: 'Customer'
            }],
        });
    }

};