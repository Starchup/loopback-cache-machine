# loopback-cache-machine
Caching system for Loopback, maintained over webhook

### Usage client side

In a boot script
```
// Instanciate with the app
var cache = new require('loopback-cache-machine')(app,
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

// And tell it what model name to listen to
cache.watchModel('Customer');
```

Then in the models you want to use cache
```
// Require the cache with no params
var cache = new require('loopback-cache-machine')();

// And boom you have access to cached data
var customer = cache.Customer[_customer_id_];
```


### Usage server side

In a boot script
```
// Prepare the network request handler (needs to be passed,
// to avoid unnecessary dependencies on cache machine)
var rp = require('request-promise');
// Instanciate with the app
var cacheServer = new require('loopback-cache-machine')(app,
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
```