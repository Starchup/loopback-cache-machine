module.exports = function startCache(app)
{
    // Server
    var rp = require('request-promise');
    var cacheServer = new require('../../cache.js')(app,
    {
        type: 'server',
        receivers: [app.get('url') + 'cache/receive'],
        send: function (uri, data)
        {
            return rp(
            {
                method: 'POST',
                uri: uri,
                body: data,
                json: true
            });
        }
    });
    cacheServer.broadcastModels('Customer');

    // Client
    var cacheClient = new require('../../cache.js')(app,
    {
        type: 'client'
    });
    cacheClient.watchModel('Customer');
};
