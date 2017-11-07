var fs         = require('fs-extra'),
    path       = require('path'),
    YAML       = require('json2yaml'),
    hash       = require('object-hash'),
    _          = require('lodash');

exports.render = function(model, options) {

    // create the output folder
    var outputFolder = path.dirname(options.outputFile);
    fs.mkdirpSync(outputFolder);

    // Outputting to file
    fs.writeFileSync(options.outputFile, YAML.stringify(generateYaml(model)));

    console.log('Generated in ' + path.resolve(options.outputFile));

};


function generateYaml(model){

    console.warn("model".yellow.bold, model);

    // write the view as YAML
    var content = require('./views/header')();

    var resources = {};

    var headerSchemaQueue =  [];
    var contentScehmaQueue =  [];

    //iterating tests to extract resources (paths values in YAML)
    for(var testNumber in model){
        var test = model[testNumber];

        //setting up the resource
        if (!resources[test.request.originalUrl]) resources[test.request.originalUrl] = {};
        var resource = resources[test.request.originalUrl];

        //setting up the method
        if (!resource[test.request.method.toLowerCase()]) resource[test.request.method.toLowerCase()] = {};
        var method = resource[test.request.method.toLowerCase()];

        //adding summary
        method.summary = test.summary;

        console.warn("test.request.requestHeaderValidator".cyan, test.request.requestHeaderValidator)

        //adding parameters
        method.parameters = [];
        for(var header in test.request.requestHeaderValidator){
            var parameter = {
                name : header,
                in : "header",
                schema: {
                    $ref : ""
                }

            }
            console.warn("header".rainbow, header)
            var joiVal = test.request.requestHeaderValidator[header];

            headerSchemaQueue.push({[hash(joiVal)] : joiVal});
            parameter.schema.$ref = '#/components/headers/' + hash(joiVal);
            method.parameters.push(parameter);
        }

        //headerSchemaQueue.push({[hash(test.request.requestHeaderValidator)] : test.request.requestHeaderValidator});
        //TODO: add path params

        //adding responses
        if (! method.responses) method.responses = {};
        method.responses[test.response.status] = {};
        var response = method.responses[test.response.status];

        //adding description to the response
        response.description = test.summary

        //setting response headers
        for(var header in test.response.headers){
            if (!response.headers) response.headers = {}
            var parameter = {}
            parameter[header] = {}
            method.parameters.push(parameter);
        }

        //setting content
        response.content = {}
        response.content['application/json'] = {}
        var ajson = response.content['application/json'];
        ajson.schema = extractArrays(test.response.respondValidator);

    }

    //TODO:: cannot handle nested arrays
    function extractArrays(joiVal, schema){
        if (!schema) schema = {};
        if(joiVal.type === 'array'){
            schema.type = "array";
            schema.items = {}
            for(var itemId in joiVal.items){ extractArrays(joiVal.items[itemId], schema) }
        }else {
            contentScehmaQueue.push({[hash(joiVal)] : joiVal});
            (schema.type !== "array") ? schema.$ref = '#/components/schemas/' + hash(joiVal)
                : schema.items.$ref = '#/components/schemas/' + hash(joiVal);
        }

        return schema;
    }

    content.paths = resources;

    //converting content Schemas extracted from tests into YAML specifications
    content.components = {}
    content.components.headers = {};
    content.components.schemas = {};

    //recursive loop to describe all object schema in the queue
    content.components.headers = consumeQueue(headerSchemaQueue, '#/components/headers/');
    content.components.schemas = consumeQueue(contentScehmaQueue, '#/components/schemas/');

    return content;
}

function processJoiRules(rules){
    if (!rules) return;
    var ruleDesc = {}
    for(var ruleId in rules){
        var rule = rules[ruleId];
        switch(rule.name){
            case "guid":
                ruleDesc.format = "uuid";
                break;
            case "precision":
                (rule.arg > 0) ? ruleDesc.format = "float" : ruleDesc.format = "integer";
                break;
            case "length":
                ruleDesc.maxLength = rule.arg;
                break;
            default:
                ruleDesc.format = rule.name;
                break;
        }
    }
    return ruleDesc;
}


function consumeQueue(schemaQueue, pathPrefix, desc){


    if(desc === undefined) desc = {}
    // if the queue is empty stop the recursive function
    if(schemaQueue.length === 0) return desc;

    //take next object from the queue
    var schemaObject = schemaQueue.shift();
    var schemaHash = Object.keys(schemaObject)[0];

    //if an object with the same hash has already been processed skip it.
    if (desc[schemaHash]) return consumeQueue(schemaQueue,pathPrefix, desc);

    // console.warn(pathPrefix.red, schemaObject);

    //prepare the component placeholder that is being processed
    desc[schemaHash] = {}
    var schemaDescription = desc[schemaHash];
    schemaDescription.properties = {};
    schemaDescription.title = schemaObject[schemaHash].title;

    //start iterating all children.
    for (var childId in schemaObject[schemaHash].children){
        var child = schemaObject[schemaHash].children[childId];
        child.title = childId;
        schemaDescription.properties[childId] = {}
        if (child.type !== "object"){
            schemaDescription.properties[childId].type = child.type;
            _.merge(schemaDescription.properties[childId], processJoiRules(child.rules));
            if(child.examples) schemaDescription.properties[childId].example = child.examples[0];
            if(child.description) schemaDescription.properties[childId].description = child.description;
            if(child.valids) schemaDescription.properties[childId].enum = child.valids;
            if(child.equal) schemaDescription.properties[childId].enum = child.equal;
            if(child.only) schemaDescription.properties[childId].enum = child.only;

            //console.warn("child".cyan.bold, child);
            //console.warn("childRules".blue.bold, processJoiRules(child.rules));

        }else{
            //if a child is itself an object prpare it's hash / ref and push it to the queue to be processed
            schemaDescription.properties[childId].$ref = pathPrefix + hash(child);
            var x = {}
            x[hash(child)] = child;
            schemaQueue.push(x);
        }
    }

    //kick off recursive function
    return consumeQueue(schemaQueue, pathPrefix, desc);
}
