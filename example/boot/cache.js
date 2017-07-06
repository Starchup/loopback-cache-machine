module.exports = function startCache(app)
{
    // Server
    var rp = require('request-promise');
    var cacheServer = new require('../../cache.js')(app,
    {
        type: 'server',
        receivers: [app.get('url')],
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

    // Client
    var cacheClient = new require('../../cache.js')(app,
    {
        type: 'client',
        broadcasters: [app.get('url')],
        ask: function (uri, data)
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
    cacheClient.watchModel('Customer');
};
