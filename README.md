# loopback-cache-machine
Caching system for Loopback, maintained over webhook

### Initialization

```
var modelNames = ['Customer', 'Order'];
`var cache = require('loopback-cache-machine')(app, modelNames);`