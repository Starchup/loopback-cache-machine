module.exports = function startCache(app)
{
    var rp = require('request-promise');
    var cacheServer = new require('../../cache.js')(app,
    {
        type: 'server',
        modelNames: ['Customer'],
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


    var cacheClient = new require('../../cache.js')(app,
    {
        type: 'client'
    });
    cacheClient.watchModel('Customer');
};
