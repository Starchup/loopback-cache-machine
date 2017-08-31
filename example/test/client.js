var app = require('../server.js');
var expect = require('chai').expect;

app.start();

describe('Test order hook', function ()
{
    var customerId = 1;
    var customerName = 'James Bond';

    before(function (done)
    {
        //Prime the cache
        var cache = require('../../cache.js')(app,
        {
            serviceName: 'test'
        });
        cache.cached.Customer[customerId] = {
            id: customerId,
            name: customerName
        };

        app.models.Order.create(
        {
            customerId: customerId
        }).then(function ()
        {
            done();
        }).catch(done);
    });

    it('should find a cached customer', function (done)
    {
        app.models.Order.findOne().then(function (order)
        {
            expect(order.customerName).to.equal(customerName);
            done();
        }).catch(done);
    });
});