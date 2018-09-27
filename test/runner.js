/*
 * Script accepts the following optional parameters:
 * --file-path [String] : Specifies the name of the file containing the tests to run. 
 *     Example: --file-path undock will run tests in the file undock.test.ts
 * --filter [String] : Filters the tests that will be run. 
 *     Valid filter syntax is described in the ava documentation: https://github.com/avajs/ava#running-tests-with-matching-titles.
 *     Example: --filter *vertical* will run all tests containing the word 'vertical'
 * Any other command line parameters will be passed through to ava as-is. 
 *     A list of valid command line parameters can be found in the ava documentation: https://github.com/avajs/ava#cli
 *     NOTE: --match is not supported, use --filter instead
 */

const execa = require('execa');
const os = require('os');
const express = require('express');

const {launch} = require('hadouken-js-adapter');

let port;

/**
 * Simple command-line parser. Returns the named argument from the list of process arguments.
 * 
 * @param {string} name Argument name, including any hyphens
 * @param {boolean} hasValue If this argument requires a value. Accepts "--name value" and "--name=value" syntax.//#endregion
 * @param {any} defaultValue Determines return value, if an argument with the given name doesn't exist. Only really makes sense when 'hasValue' is true.
 */
function getArg(name, hasValue, defaultValue = hasValue ? null : false) {
    let value = defaultValue;
    let argIndex = unusedArgs.indexOf(name);

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
const unusedArgs = process.argv.slice(2);

const testFileName = getArg('--file-name', true, '*');
const testNameFilter = getArg('--filter', true);
const showHelp = getArg('--help') || getArg('-h');
const skipBuild = getArg('--run') || getArg('-r');

if (showHelp) {
    console.log(`Test runner accepts the following arguments. Any additional arguments will be passed-through to the test runner, see "ava --help" for details.

NOTE: When running through 'npm test', pass -- before any test runner options, to stop NPM from consuming those arguments. For example, 'npm test -- -b'.

Options:
--file-name <file>      Runs all tests in the given file
--filter <pattern>      Only runs tests whose names match the given pattern. Can be used with --file-name.
--help | -h             Displays this help
--run | -r              Skips the build step, and will *only* run the tests - rather than the default 'build & run' behaviour.
`);
    process.exit();
}

const testCommand = `ava --serial build/test/**/${testFileName}.test.js ${testNameFilter ? '--match ' + testNameFilter: ''} ${unusedArgs.join(' ')}`;

const cleanup = async res => {
    if (os.platform().match(/^win/)) {
        const cmd = 'taskkill /F /IM openfin.exe /T';
        execa.shellSync(cmd);
    } else {
        const cmd = `lsof -n -i4TCP:${port} | grep LISTEN | awk '{ print $2 }' | xargs kill`;
        execa.shellSync(cmd);
    }
    process.exit((res.failed===true) ? 1 : 0);
}

const fail = err => {
    console.error(err);
    process.exit(1);
}

const run = (...args) => {
    const p = execa(...args)
    p.stdout.pipe(process.stdout)
    p.stderr.pipe(process.stderr)
    return p
}

/**
 * Performs a clean build of the application and tests
 */
async function build() {
    await run('npm', ['run', 'clean']);
    await run('npm', ['run', 'build']);
    await run('tsc', ['-p', 'test', '--skipLibCheck']);
}

/**
 * Starts a local server for hosting the test windows
 */
async function serve() {
    return new Promise((resolve, reject) => {
        const app = express();
        
        app.use(express.static('build'));
        app.use(express.static('res'));
        
        console.log("Starting test server...");
        app.listen(1337, resolve);
    });
}

const buildStep = skipBuild ? Promise.resolve() : build();

buildStep
    .then(() => serve())
    .then(async () => {
        port = await launch({manifestUrl: 'http://localhost:1337/test/app.json'});
        console.log('Openfin running on port ' + port);
        return port
    })
    .catch(fail)
    .then(OF_PORT => run(testCommand , { env: { OF_PORT } }))
    .then(cleanup)
    .catch(cleanup);
    