var cache = new require('../../cache.js')();

module.exports = function (Order)
{
    // Before an order is about to be saved, add it's customer's name to it
    // pretty useless.. but you get to see how cache-machine works!
    Order.observe('before save', function (ctx, next)
    {
        var order = null;
        if (ctx.data) order = ctx.data;
        else if (ctx.instance) order = ctx.instance;
        else return next();

        var customer = cache.Customer[order.customerId];

        if (!customer) return next(new Error('CustomerId is not valid: ' + JSON.stringify(order)));

        order.customerName = customer.name;

        next();
    });
};
