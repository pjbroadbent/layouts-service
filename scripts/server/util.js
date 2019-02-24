const fs = require('fs');
const path = require('path');

const {PORT, CDN_LOCATION} = require('./config');

/**
 * Simple command-line parser. Returns the named argument from the list of process arguments.
 * 
 * @param {string} name Argument name, including any hyphens
 * @param {boolean} hasValue If this argument requires a value. Accepts "--name value" and "--name=value" syntax.
 * @param {any} defaultValue Determines return value, if an argument with the given name doesn't exist. Only really makes sense when 'hasValue' is true.
 */
function getArg(name, hasValue, defaultValue = hasValue ? null : false) {
    const unusedArgs = global.unusedArgs = (global.unusedArgs || process.argv.slice(2).map(arg => arg.toLowerCase()));
    let value = defaultValue;
    let argIndex = unusedArgs.indexOf(name.toLowerCase());

    if (argIndex >= 0 && argIndex < unusedArgs.length - (hasValue ? 1 : 0)) {
        if (hasValue) {
            // Take the argument after this as being the value
            value = unusedArgs[argIndex + 1];
            unusedArgs.splice(argIndex, 2);
        } else {
            // Only consume the one argument
            value = true;
            unusedArgs.splice(argIndex, 1);
        }
    } else if (hasValue) {
        argIndex = unusedArgs.findIndex((arg) => arg.indexOf(name + '=') === 0);
        if (argIndex >= 0) {
            value = unusedArgs[argIndex].substr(unusedArgs[argIndex].indexOf('=') + 1);
            unusedArgs.splice(argIndex, 1);
        }
    }

    return value;
}

/**
 * Returns the URL of the manifest file for the requested version of the service.
 * 
 * @param {string} version Version number of the service, or a channel
 * @param {string} manifestUrl The URL that was set in the application manifest (if any). Any querystring arguments will be persisted, but the rest of the URL will be ignored.
 */
function getProviderUrl(version, manifestUrl) {
    const index = manifestUrl && manifestUrl.indexOf("?");
    const query = index >= 0 ? manifestUrl.substr(index) : "";

    if (version === 'local') {
        // Provider is running locally
        return `http://localhost:${PORT}/provider/app.json${query}`;
    } else if (version === 'stable') {
        // Use the latest stable version
        return `${CDN_LOCATION}/app.json${query}`;
    } else if (version === 'staging') {
        // Use the latest staging build
        return `${CDN_LOCATION}/app.staging.json${query}`;
    } else if (/\d+\.\d+\.\d+/.test(version)) {
        // Use a specific public release of the service
        return `${CDN_LOCATION}/${version}/app.json${query}`;
    } else if (version.indexOf('://') > 0) {
        // Looks like an absolute URL to an app.json file
        return version;
    } else {
        throw new Error(`Not a valid version number or channel: ${version}`);
    }
}

/**
 * Returns the URL of the manifest file for the requested version of the service.
 * 
 * @param {string} version Version number of the service, or a channel
 * @param {string} manifestUrl The URL that was set in the application manifest (if any). Any querystring arguments will be persisted, but the rest of the URL will be ignored.
 */
function readJsonFile(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(path.resolve('res', filePath), 'utf8', (error, data) => {
            if (error) {
                reject(error);
            } else {
                try {
                    const config = JSON.parse(data);

                    if (config) {
                        resolve(config);
                    } else {
                        throw new Error(`No data found in ${filePath}`);
                    }
                } catch(e) {
                    reject(e);
                }
            }
        });
    });
}

module.exports = {getArg, getProviderUrl, readJsonFile};
