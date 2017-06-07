# loopback-cache-machine
Caching system for Loopback, maintained over webhook

### Usage client side

In a boot script
```
// Instanciate with the app
var cache = new require('../cache.js')(app);

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

