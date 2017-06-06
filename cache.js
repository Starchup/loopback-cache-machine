/* Module Dependencies */
var pluralize = require('pluralize');

/* Constructor */
module.exports = function (app, modelNames)
{
    var self = this;

    modelNames.forEach(modelName =>
    {
        self[modelName] = [];
    });

    return self;
}
