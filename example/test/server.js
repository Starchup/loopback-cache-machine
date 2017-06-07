var app = require('../server.js');
var expect = require('chai').expect;
var rp = require('request-promise');

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
        var cache = new require('../../cache.js')();

        expect(cache.Customer).to.exist;
        expect(cache.Customer[customerData.id]).to.exist;
        expect(cache.Customer[customerData.id].name).to.equal(customerData.name);

        done();
    });
});
