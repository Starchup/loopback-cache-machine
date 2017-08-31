var app = require('../server.js');
var expect = require('chai').expect;

describe('Test cache emitting', function ()
{
    var customerData = {
        id: 2,
        name: 'Tom Cruise'
    }

    before(function (done)
    {
        app.models.Customer.create(customerData).then(function ()
        {
            done();
        }).catch(done);
    });

    it('should find the customer cached', function (done)
    {
        var cache = require('../../cache.js')(app,
        {
            serviceName: 'test'
        });

        expect(cache.Customer).to.exist;
        expect(cache.Customer[customerData.id]).to.exist;
        expect(cache.Customer[customerData.id].name).to.equal(customerData.name);

        done();
    });
});