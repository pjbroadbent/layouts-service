const path = require('path');
const webpack = require('webpack');
const webpackDevMiddleware = require('webpack-dev-middleware');

const {PORT, CDN_LOCATION} = require('./config');
const {readJsonFile} = require('./util');

/**
 * Creates express-compatible middleware function that will add/replace any URL's found within app.json files according
 * to the command-line options of this utility.
 */
function createAppJsonMiddleware() {
    return async (req, res, next) => {
        const configPath = req.params[0];           // app.json path, relative to 'res' dir
        const component = configPath.split('/')[0]; // client, provider or demo

        // Parse app.json
        const config = await readJsonFile(path.resolve('res', configPath)).catch(next);
        const serviceDefinition = (config.services || []).find(service => service.name === SERVICE_NAME);
        const startupUrl = config.startup_app && config.startup_app.url;

        // Edit manifest
        if (startupUrl) {
            // Replace startup app with HTML served locally
            config.startup_app.url = startupUrl.replace(CDN_LOCATION, `http://localhost:${PORT}/${component}`);
        }
        if (serviceDefinition) {
            // Replace provider manifest URL with the requested version
            serviceDefinition.manifestUrl = getProviderUrl(providerVersion, serviceDefinition.manifestUrl);
        }

        // Return modified JSON to client
        res.header('Content-Type', 'application/json; charset=utf-8');
        res.send(JSON.stringify(config, null, 4));
    };
}

/**
 * Creates express-compatible middleware function to serve webpack modules.
 * 
 * Wrapper will immediately terminate the server if the initial build fails.
 * 
 * This is a wrapper around the webpack-dev-middleware utility.
 */
async function createWebpackMiddleware(mode, writeToDisk) {
    return new Promise((resolve) => {
        // Load config and set development mode
        console.log(process.cwd());
        // console.log(require('fs').readFileSync('./webpack.config.js', {encoding: 'utf8'}));
        const config = require(path.resolve('./webpack.config.js'));
        console.log(config);
        config.forEach(entry => entry.mode = (entry.mode || mode));

        // Create express middleware
        const compiler = webpack(config);
        const middleware = webpackDevMiddleware(compiler, {
            publicPath: '/',
            writeToDisk
        });

        // Wait until initial build has finished before starting application
        const startTime = Date.now();
        middleware.waitUntilValid((result) => {
            // Output build times
            const buildTimes = result.stats.map(stats => {
                const component = path.relative('./dist', stats.compilation.outputOptions.path);
                return `${component}: ${(stats.endTime - stats.startTime) / 1000}s`;
            });
            console.log(`\nInitial build complete after ${(Date.now() - startTime) / 1000} seconds\n    ${buildTimes.join('\n    ')}\n`);

            // Check build status
            if (result.stats.find(stats => stats.compilation.errors.length > 0)) {
                console.error('Build failed. See output above.');
                process.exit(1);
            } else {
                resolve(middleware);
            }
        });
    });
}

/**
 * Creates express-compatible middleware function to generate custom application manifests.
 * 
 * Differs from createAppJsonMiddleware (defined in server.js), as this spawns custom demo windows, rather than 
 * re-writing existing demo/provider manifests.
 */
function createCustomManifestMiddleware() {
    return async (req, res, next) => {
        const defaultConfig = await readJsonFile(path.resolve('res/demo/app.json')).catch(next);
        const {uuid, url, frame, defaultCentered, defaultLeft, defaultTop, defaultWidth, defaultHeight, realmName, enableMesh, runtime, useService, provider, config} = {
            // Set default values
            uuid: `demo-app-${Math.random().toString(36).substr(2, 4)}`,
            url: `http://localhost:${PORT}/demo/testbed/index.html`,
            runtime: defaultConfig.runtime.version,
            provider: 'local',
            config: null,

            // Override with query args
            ...req.query,

            // Special handling for any non-string args (both parses query string args, and defines default values)
            frame: req.query.frame !== 'false',
            enableMesh: req.query.enableMesh !== 'false',
            useService: req.query.useService !== 'false',
            defaultCentered: req.query.defaultCentered === 'true',
            defaultLeft: parseInt(req.query.defaultLeft) || 860,
            defaultTop: parseInt(req.query.defaultTop) || 605,
            defaultWidth: parseInt(req.query.defaultWidth) || 860,
            defaultHeight: parseInt(req.query.defaultHeight) || 605
        };

        const manifest = {
            startup_app: {
                uuid,
                name: uuid,
                url,
                frame,
                autoShow: true,
                saveWindowState: false,
                defaultCentered,
                defaultLeft,
                defaultTop,
                defaultWidth,
                defaultHeight
            },
            runtime: {
                arguments: "--v=1" + (realmName ? ` --security-realm=${realmName}${enableMesh ? ' --enable-mesh' : ''}` : ''),
                version: runtime
            }
        };
        if (useService) {
            const service = {name: 'layouts'};
            if (provider !== 'default') {
                service.manifestUrl = getProviderUrl(provider);
            }
            if (config) {
                service.config = JSON.parse(config);
            }
            manifest.services = [service];
        }

        // Return modified JSON to client
        res.header('Content-Type', 'application/json; charset=utf-8');
        res.send(JSON.stringify(manifest, null, 4));
    };
}

module.exports = {createAppJsonMiddleware, createWebpackMiddleware, createCustomManifestMiddleware};
