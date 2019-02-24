const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');

const root = '.';
const inputDir = 'src/demo';
const outputDir = '../sandbox';

async function main() {
    // Create output directory
    mkdirp.sync(path.resolve(root, outputDir));

    // Create "sandbox" app
    transposeFiles('');
    createPackage();
    createServerScript();
    createWebpackConfig();
}

/**
 * Copy demo app sources, tranlating imports to use NPM module
 * 
 * @param {string} directory Directory to scan for input files
 */
function transposeFiles(directory) {
    const clientImport = /^import (({.*})|(\* as .*)) from '(..\/)+client\/(.*)';$/m;
    const genImport = /^import (({.*})|(\* as .*)) from '((..\/)+.*)';$/m;
    const hadoukenImport = /^import (({.*})|(\* as .*)) from 'hadouken-js-adapter(\/.*)?';$/m;

    const items = fs.readdirSync(path.resolve(root, inputDir, directory), {encoding: 'utf8'});
    items.forEach((item) => {
        const itemPath = path.resolve(root, inputDir, directory, item);
        const outDir = path.resolve(root, outputDir, directory);
        const outPath = path.resolve(outDir, item);

        if (fs.statSync(itemPath).isDirectory()) {
            // Iterate into sub-directory
            mkdirp.sync(path.resolve(root, outputDir, directory, item));
            transposeFiles(path.relative(path.resolve(root, inputDir), itemPath));
        } else {
            // Copy folder to 'gen' dir
            let contents = fs.readFileSync(itemPath, {encoding: 'utf8'});
            // console.log(contents);

            if (path.extname(item) === '.ts') {
                let match;

                // Replace imports to '../client' with 'openfin-layouts'
                contents = contents.split('\n').map(line => {
                    if ((match = clientImport.exec(line)) !== null) {
                        const src = match[5];

                        let packagePath;
                        if (src === '' || src === 'main') {
                            packagePath = '';
                        } else {
                            packagePath = `/dist/client/${src}`;
                        }

                        return `import ${match[1]} from 'openfin-layouts${packagePath}';`;
                    } else if ((match = genImport.exec(line)) !== null) {
                        const relative = path.relative(outDir, path.resolve(path.dirname(itemPath), match[4])).replace(/\\/g, '/');
                        return `import ${match[1]} from '${relative}';`;
                    } else if ((match = hadoukenImport.exec(line)) !== null) {
                        const relative = path.relative(outDir, path.resolve(root, 'node_modules/hadouken-js-adapter')).replace(/\\/g, '/');
                        return `import ${match[1]} from '${relative}${match[4] || ""}';`;
                    } else {
                        return line;
                    }
                }).join('\n');
            } else if (item === 'tsconfig.json') {
                const pathPattern = /"([^"]*)\.\.\/([^"]*)"/mg;
                const orig = contents;
                let match;
                
                // Transpose all paths within tsconfig
                while(match = pathPattern.exec(orig)) {
                    const inPath = path.resolve(root, inputDir, directory, `${match[1]}../${match[2]}`);
                    const modifiedPath = path.relative(outDir, inPath);
                    
                    const offset = contents.length - orig.length;
                    contents = [contents.slice(0, match.index + offset), `"${modifiedPath.replace(/\\/g, '/')}"`, contents.slice(match.index + match[0].length + offset)].join('');
                }
                
                // Find project rootDir
                const inParts = itemPath.split(path.sep);
                const outParts = outDir.split(path.sep);
                let rootDir = '', i=0;
                for(let i=0, max=Math.min(inParts.length, outParts.length); i<max; i++) {
                    if (inParts[i] === outParts[i]) {
                        rootDir += inParts[i] + path.sep;
                    } else {
                        break;
                    }
                }
                rootDir = path.relative(outDir, rootDir).replace(/\\/g, '/');

                const config = JSON.parse(contents);
                config.compilerOptions = {rootDir};
                contents = JSON.stringify(config, null, 4);
            }

            fs.writeFileSync(outPath, contents, {encoding: 'utf8'});
        }
    });
}

/**
 * Create a package.json for the sandbox app
 */
function createPackage() {
    // Import some values from main package.json
    const input = require(path.resolve(root, 'package.json'));
    const {name, version, dependencies, devDependencies} = input;

    // Construct package.json for 'sandbox' app
    const output = {
        name: `${name}-sandbox`,
        version,
        dependencies: {
            ...dependencies,
            'openfin-layouts': path.relative(path.resolve(outputDir), path.resolve(root, `${name}-${version}.tgz`))
        },
        devDependencies,
        scripts: {
            start: 'node server.js'
        }
    };
    
    fs.writeFileSync(path.resolve(root, outputDir, 'package.json'), JSON.stringify(output, null, 2), {encoding: 'utf8'});
}

function createWebpackConfig() {
    // Import some values from main config
    const input = require(path.resolve(root, 'webpack.config.js'));
    const output = input.filter(x => x.output.path.endsWith('/demo'));

    output.forEach(config => {
        Object.keys(config.entry).forEach(key => {
            config.entry[key] = config.entry[key].replace('./src/demo/', './');
            config.plugins = [];
        })
    })

    // Stringify config, whilst preserving regex expression
    const config = JSON.stringify(output, (key, value) => {
        if (value instanceof RegExp) {
            return `${value.toString()}`;
        } else {
            return value;
        }
    }, 4).replace('"/\\\\.tsx?$/"', '/\.tsx?$/');

    fs.writeFileSync(path.resolve(root, outputDir, 'webpack.config.js'), `module.exports = ${config};`, {encoding: 'utf8'});
}

/**
 * Write server.js script, to build and launch the sandbox app
 */
function createServerScript() {
    const basePath = path.relative(outputDir, root).replace(/\\/g, '/');
    const script = `\
const {launch, connect} = require('hadouken-js-adapter');
const os = require('os');
const express = require('express');
const {PORT} = require('${basePath}/scripts/server/config');
const {createAppJsonMiddleware, createWebpackMiddleware, createCustomManifestMiddleware} = require('${basePath}/scripts/server/middleware');
const {getArg, getProviderUrl} = require('${basePath}/scripts/server/util');

const providerVersion = getArg('--version', true, 'staging');
const mode = getArg('--mode', true, 'development');
const launchApp = !getArg('--noLaunch', false);
const static = getArg('--static', false);
const writeToDisk = getArg('--write', false);

async function createServer() {
    const app = express();
    app.use(/\\/?(.*app\\.json)/, createAppJsonMiddleware());
    app.use('/manifest', createCustomManifestMiddleware(mode, writeToDisk));
    app.use(express.static('res'));
    app.use(await createWebpackMiddleware());
    return app;
}

createServer().then((app) => {
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
            connect({uuid: 'wrapper', manifestUrl: \`http://localhost:\${PORT}/\${manifestPath}\`}).then(async fin => {
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
});
`;

    fs.writeFileSync(path.resolve(root, outputDir, 'server.js'), script, {encoding: 'utf8'});
}

main();
