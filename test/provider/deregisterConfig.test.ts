import {Context, GenericTestContext, test} from 'ava';
import {Fin, Window} from 'hadouken-js-adapter';
import * as robot from 'robotjs';

import {ConfigurationObject} from '../../gen/provider/config/layouts-config';
import {Scope} from '../../gen/provider/config/scope';
import {CreateWindowData, createWindowTest, WindowContext} from '../demo/utils/createWindowTest';
import {executeJavascriptOnService, layoutsClientPromise} from '../demo/utils/serviceUtils';
import {isWindowRegistered} from '../demo/utils/snapServiceUtils';
import {assertWindowRestored} from '../demo/utils/workspacesUtils';

import {assertGrouped, assertNotGrouped, assertTabbed} from './utils/assertions';
import {getConnection} from './utils/connect';
import {createChildWindow} from './utils/createChildWindow';
import {delay} from './utils/delay';
import {dragWindowAndHover} from './utils/dragWindowAndHover';
import {dragSideToSide, dragWindowTo} from './utils/dragWindowTo';
import {getBounds} from './utils/getBounds';
import {getWindow} from './utils/getWindow';
import {tabWindowsTogether} from './utils/tabWindowsTogether';

type TestContext = GenericTestContext<Context<{windows: Window[]}>>;

const DEFAULT_OPTIONS: fin.WindowOptions = {
    url: 'http://localhost:1337/demo/popup.html',
    autoShow: true,
    saveWindowState: false,
    defaultTop: 100,
    defaultLeft: 100,
    defaultWidth: 300,
    defaultHeight: 200
};

test.beforeEach(async (t: TestContext) => {
    t.context.windows = [];
});
test.afterEach.always(async (t: TestContext) => {
    await executeJavascriptOnService(function(this: ProviderWindow) {
        this.config.removeFromSource({level: 'window', uuid: 'testApp', name: 'testWindow'});
        this.config.removeFromSource({level: 'window', uuid: 'testApp', name: 'testWindow1'});
        this.config.removeFromSource({level: 'window', uuid: 'testApp', name: 'testWindow2'});
    });
    await Promise.all(t.context.windows.map(win => win.close()));
});

async function addRuleToProvider(scope: Scope, config: ConfigurationObject): Promise<void> {
    return executeJavascriptOnService(function(this: ProviderWindow, data) {
        this.config.add(data.scope, data.config);
    }, {scope, config});
}


test('Window can be de-registered by adding a rule to the store', async (t: TestContext) => {
    const win = await createChildWindow({...DEFAULT_OPTIONS, name: 'testWindow'});
    t.context.windows.push(win);

    t.true(await isWindowRegistered(win.identity));
    await addRuleToProvider({level: 'window', uuid: 'testApp', name: 'testWindow'}, {enabled: false});
    t.false(await isWindowRegistered(win.identity));
});

test('A de-registered window can be re-registered by adding a rule to the store', async t => {
    const win = await createChildWindow({...DEFAULT_OPTIONS, name: 'testWindow', url: 'http://localhost:1337/test/popup-deregistered.html'});
    t.context.windows.push(win);

    t.false(await isWindowRegistered(win.identity));
    await addRuleToProvider({level: 'window', uuid: 'testApp', name: 'testWindow'}, {enabled: true});
    t.true(await isWindowRegistered(win.identity));
});

test('When a snapped window is de-registered, it is removed from its snap group', async (t: TestContext) => {
    const windows = t.context.windows;
    windows.push(
        await createChildWindow({...DEFAULT_OPTIONS, name: 'testWindow1'}),
        await createChildWindow({...DEFAULT_OPTIONS, name: 'testWindow2'})
    );

    await dragSideToSide(windows[0], 'left', windows[1], 'right');
    await assertGrouped(t, ...windows);
    await addRuleToProvider({level: 'window', uuid: 'testApp', name: 'testWindow1'}, {enabled: false});

    t.false(await isWindowRegistered(windows[0].identity));
    t.true(await isWindowRegistered(windows[1].identity));

    const groups = await Promise.all(windows.map(w => w.getGroup()));
    t.is(groups[0].length, 0);
    t.is(groups[1].length, 0);
});

test('When a tabbed window is de-registered, it is removed from its tab group', async (t: TestContext) => {
    const windows = t.context.windows;
    const w1 = await createChildWindow({...DEFAULT_OPTIONS, name: 'testWindow1'});
    const w2 = await createChildWindow({...DEFAULT_OPTIONS, name: 'testWindow2'});
    windows.push(w1, w2);

    await tabWindowsTogether(windows[0], windows[1]);

    await delay(1000);

    await assertTabbed(windows[0], windows[1], t);
    await addRuleToProvider({level: 'window', uuid: 'testApp', name: 'testWindow1'}, {enabled: false});

    t.false(await isWindowRegistered(windows[0].identity));
    t.true(await isWindowRegistered(windows[1].identity));

    const groups = await Promise.all(windows.map(w => w.getGroup()));
    t.is(groups[0].length, 0);
    t.is(groups[1].length, 0);
});