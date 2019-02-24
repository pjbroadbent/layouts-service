const {launch, connect} = require('hadouken-js-adapter');
const express = require('express');
const os = require('os');

const {PORT} = require('./scripts/server/config');
const {createAppJsonMiddleware, createWebpackMiddleware, createCustomManifestMiddleware} = require('./scripts/server/middleware');
const {getProviderUrl} = require('./scripts/server/middleware');


/**
 * Chooses which version of the provider to run against. Will default to building and running a local version of the provider.
 * 
 * - "local"
 *   Starts a local version of the provider, built from the code in 'src/provider'
 * - "stable"
 *   Runs the latest public release of the service from the OpenFin CDN
 * - "staging"
 *   Runs the latest internal build of the service from the OpenFin CDN. May be unstable.
 * - <version number>
 *   Specifiying a "x.y.z" version number will load that version of the service from the OpenFin CDN.
 */
const providerVersion = getArg('--version', true, 'local');

/**
 * The mode to use for webpack, either 'development' (default) or 'production'.
 */
const mode = getArg('--mode', true, 'development');

/**
 * If the demo application should be launched after building (default: true).
 * 
 * Otherwise will build and start the local server, but not automatically launch any applications.
 */
const launchApp = !getArg('--noLaunch', false);

/**
 * Rather than building the application via webpack (and then watching for any source file changes), will launch the
 * provider from pre-built code within the 'dist' directory.
 * 
 * You should first build the provider using either 'npm run build' or 'npm run build:dev'. This option has no effect if
 * '--version' is set to anything other than 'local'.
 */
const static = getArg('--static', false);

/**
 * By default, webpack-dev-server builds and serves files from memory without writing to disk. Using this option will
 * also write the output to the 'dist' folder, as if running one of the 'build' scripts.
 */
const writeToDisk = getArg('--write', false);

// Start local server
(async () => {
    const app = await createServer();

    console.log('Starting application server...');
    app.listen(PORT, async () => {
        // Manually start service on Mac OS (no RVM support)
        if (os.platform() === 'darwin') {
            console.log('Starting Provider for Mac OS');
        
            // Launch latest stable version of the service
            await launch({manifestUrl: getProviderUrl(providerVersion)}).catch(console.log);
        }

        // Launch application, if requested to do so
        if (launchApp) {
            const manifestPath = 'demo/app.json';

            console.log('Launching application');
            connect({uuid: 'wrapper', manifestUrl: `http://localhost:${PORT}/${manifestPath}`}).then(async fin => {
                const service = fin.Application.wrapSync({uuid: 'layouts-service', name: 'layouts-service'});

                // Terminate local server when the demo app closes
                service.addListener('closed', async () => {
                    process.exit(0);
                }).catch(console.error);
            }, console.error);
        } else {
            console.log('Local server running');
        }
    });
})();

/**
 * Adds the necessary middleware to the express instance
 * 
 * - Will serve static resources from the 'res' directory
 * - Will serve application code from the 'src' directory
 *   - Uses webpack middleware to first build the application
 *   - Middleware runs webpack in 'watch' mode; any changes to source files will trigger a partial re-build
 * - Any 'app.json' files within 'res' are pre-processed
 *   - Will explicitly set the provider URL for the service
 */
async function createServer() {
    const app = express();

    // Add special route for any 'app.json' files - will re-write the contents according to the command-line arguments of this server
    app.use(/\/?(.*app\.json)/, createAppJsonMiddleware());

    // Add endpoint for creating new application manifests from scratch - used within demo app for lauching 'custom' applications
    app.use('/manifest', createCustomManifestMiddleware(mode, writeToDisk));

    // Add route for serving static resources
    app.use(express.static('res'));

    // Add route for code
    if (static) {
        // Run application using pre-built code (use 'npm run build' or 'npm run build:dev')
        app.use(express.static('dist'));
    } else {
        // Run application using webpack-dev-middleware. Will build app before launching, and watch for any source file changes
        app.use(await createWebpackMiddleware());
    }

    return app;
}
