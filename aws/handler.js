'use strict';

const Healthpack = require('./healthpack');


let corsHeaders = {
            "Access-Control-Allow-Origin" : "*"
	}

module.exports.ping = (event, context, callback) => {
    const response = {
        statusCode: 200,
	headers: corsHeaders,
        body: JSON.stringify({
            message: "ack",
            input: event,
        })
    }
    callback(null, response)
}

module.exports.dose = (event, context, callback) => {
  console.log(event)
  healthpack.dose(callback)
}

module.exports.close = (event, context, callback) => {
  console.log(event)
  healthpack.close(callback)
}

module.exports.reminder = (event, context, callback) => {
  console.log(event)
  healthpack.reminder(callback)
}

module.exports.alert = (event, context, callback) => {
  console.log(event)
  healthpack.alert(callback)
}

