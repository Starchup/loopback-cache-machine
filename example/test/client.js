var app = require('../server.js');
var expect = require('chai').expect;
var rp = require('request-promise');

app.start();

describe('Test order hook', function ()
{
    var customerId = 1;
    var customerName = 'James Bond';

    before(function (done)
    {
        var options = {
            method: 'POST',
            uri: app.get('url') + 'cache/receive',
            body:
            {
                modelName: 'Customer',
                methodName: 'Update',
                data:
                {
                    id: customerId,
                    name: customerName
                }
            },
            json: true
        };

        rp(options).then(function (res)
        {
            return app.models.Order.create(
            {
                customerId: customerId
            });
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
