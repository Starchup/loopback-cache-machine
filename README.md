# loopback-cache-machine
Caching system for Loopback, maintained via GoogleCloud PubSub

### Usage client side

In a boot script
```
// Instanciate with the app and tell it what model name to listen to
var cache = require('loopback-cache-machine')(app,
{
    type: 'client',
    serviceName: CACHE_CLIENT_NAME,
    projectId: GOOGLE_CLOUD_PROJECT_ID,
    modelsToWatch: [{modelName: 'Customer'}],
    //Optional event config
    eventConfig: {
        events: ['Order.create', 'Order.update', 'Order.delete'],
        //eventFn will trigger for all events
        eventFn: function(modelName, methodName, modelId, data, cb) {...}
    }
    //Optional readiness callback, res is intitial cached data on success
    onReady: function(err, res) { .... }
});
```


Then in the models you want to use cache
```
// Require the cache with options.serviceName
var cache = require('loopback-cache-machine')(app, {serviceName: CACHE_NAME});

// And boom you have access to cached data
var customer = cache.cached.Customer[_customer_id_];
```


### Usage server side

In a boot script
```

// Instanciate with the app
var cacheServer = require('loopback-cache-machine')(app,
{
    type: 'server',
    serviceName: CACHE_SERVER_NAME,
    projectId: GOOGLE_CLOUD_PROJECT_ID,
    //Optional list of functions taking (modelName, methodName, instance, ctx) as arguments. If any return false, message will not be published
    filters: [filterFunction1, filterFunction2],
    //Optional readiness callback, res is true on success
    onReady: function(err, res) { .... }
});
```

### Usage locally

In a boot script
```

// Instanciate with the app
var cacheServer = require('loopback-cache-machine')(app,
{
    type: 'local',
    projectId: GOOGLE_CLOUD_PROJECT_ID
    modelsToWatch: [{modelName: 'Customer'}],
    //Optional readiness callback, res is intitial cached data on success
    onReady: function(err, res) { .... }
});
```
Then in the models you want to use cache
```
// Require the cache with options.serviceName
var cache = require('loopback-cache-machine')(app, {serviceName: CACHE_NAME});

// And boom you have access to cached data
var customer = cache.cached.Customer[_customer_id_];
```

### Notes
* Multiple caches and cache types may exist on a single app instance, but only one per name.
* The cache is not initialized and primed with data until called with a valid `options.type` (server/client/local).
* `process.env.NODE_ENV` is required, as it is used to differentiate topic and subscription names by environment on Google PubSub.
