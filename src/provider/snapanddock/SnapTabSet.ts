import {Tab} from '../tabbing/Tab';
import {TabGroup} from '../tabbing/TabGroup';
import {SnapGroup} from './SnapGroup';
import {eTransformType, Mask, SnapWindow, WindowState} from './SnapWindow';
import {p, promiseMap} from './utils/async';
import {PointUtils} from './utils/PointUtils';


/**
 * A representation of a tab group (created/managed/owned by the tabbing service) within the snapping service.
 *
 * This will eventually be merged with TabGroup, so that there is only one such representation of a tab set within the
 * service.
 */
export class SnapTabSet extends SnapWindow {
    private tabGroup: TabGroup;
    private tabs: SnapWindow[];

    /**
     * WindowState object for a unified "pseudo" window, that covers both the tab strip and the attached application
     * windows.
     */
    private pseudoState: WindowState;

    /**
     * If this object has been initialised. Can't fully initialise until we receive the window state of the tab strip.
     *
     * There is no public init method, object will be initialised once internal cOallbacks have completed.
     */
    private initialised: boolean;

    constructor(tabGroup: TabGroup, group: SnapGroup, window: fin.OpenFinWindow) {
        super(group, window, {
            // Not possible to both asynchronously fetch the window state, and synchronously create the necessary tab/tabset objects.
            // Need to initialise with a dummy state, then fetch for 'real' state after object creation
            center: {x: 0, y: 0},
            halfSize: {x: 0, y: 0},
            frame: false,
            hidden: false,
            state: 'normal',
            minWidth: 0,
            maxWidth: 0,
            minHeight: 0,
            maxHeight: 0,
            opacity: 1
        });

        this.tabGroup = tabGroup;
        this.tabs = [];
        this.tabSet = this;
        this.pseudoState = {...this.state};
        this.initialised = false;
        this.onTransform.add(this.onWindowTransformed, this);

        // Hack: Asynchronously query for "real" window state, to replace the hard-coded fake window state
        setTimeout(async () => {  // Hack: Need to wait for window to initialise
            const tabStripState: WindowState = await SnapWindow.getWindowState(window);
            Object.apply(this.pseudoState, tabStripState);
            this.setBounds();
            this.initialised = true;
        }, 500);
    }

    public getState(): WindowState {
        if (this.initialised) {
            return this.pseudoState;
        } else {
            return this.state;
        }
    }

    public getTabs(): SnapWindow[] {
        return this.tabs;
    }

    public addTab(tab: Tab, window: SnapWindow): void {
        const {uuid, name} = tab.window.finWindow;
        const id = `${uuid}/${name}`;
        const index: number = this.tabs.findIndex((tabWindow: SnapWindow) => {
            return tabWindow.getId() === id;
        });

        if (index === -1) {
            this.tabs.push(window);
            window.onTransform.add(this.onWindowTransformed, this);
            window.setTabSet(this);
        } else {
            console.warn('Attempting to add a tab that already exists within tab set', tab);
            if (this.tabs[index] !== window) {
                console.warn('Duplicate window - multiple SnapWindows exist for tab', tab);
            }
        }
    }

    public removeTab(tab: Tab, window: SnapWindow): void {
        const {uuid, name} = tab.window.finWindow;
        const id = `${uuid}/${name}`;
        const index: number = this.tabs.findIndex((tabWindow: SnapWindow) => {
            return tabWindow.getId() === id;
        });

        if (index >= 0) {
            if (this.tabs[index] !== window) {
                console.warn('Duplicate window - multiple SnapWindows exist for tab', tab);
            }

            this.tabs.splice(index, 1);
            window.onTransform.remove(this.onWindowTransformed, this);
            window.clearTabSet();
        } else {
            console.warn('Attempting to add a tab that already exists within tab set', tab);
        }
    }

    protected async snap(): Promise<void> {
        await super.snap();

        const windows: SnapWindow[] = this.group.windows;
        const index = windows.indexOf(this);
        const targetWindow: fin.OpenFinWindow = windows[index === 0 ? 1 : 0].getWindow();
        await promiseMap(this.tabs, async (tab: SnapWindow) => {
            const tabWindow = tab.getWindow();
            await p<fin.OpenFinWindow, void>(tabWindow.joinGroup.bind(tabWindow))(targetWindow);
        });
    }

    protected async unsnap(): Promise<void> {
        await super.unsnap();
        await promiseMap(this.tabs, async (tab: SnapWindow) => {
            const tabWindow = tab.getWindow();
            await p<void>(tabWindow.leaveGroup.bind(tabWindow))();
        });
    }

    private onWindowTransformed(window: SnapWindow, type: Mask<eTransformType>): void {
        this.setBounds();
    }

    private setBounds(): void {
        const activeTab: Tab = this.tabGroup.activeTab;
        const activeTabId = `${activeTab.window.finWindow.uuid}/${activeTab.window.finWindow.name}`;
        const activeWindow: SnapWindow|undefined = this.tabs.find((tab: SnapWindow) => tab.getId() === activeTabId);

        if (activeWindow) {
            const pseudoState: WindowState = this.pseudoState;
            const tabStripState: WindowState = this.state;
            const activeState: WindowState = activeWindow.getState();

            pseudoState.center.x = activeState.center.x;
            pseudoState.center.y = activeState.center.y - tabStripState.halfSize.y;
            pseudoState.halfSize.x = activeState.halfSize.x;
            pseudoState.halfSize.y = activeState.halfSize.y + tabStripState.halfSize.y;
        } else {
            console.warn('Couldn\'t find active tab within SnapTabSet: ', activeTab);

            const pseudoState: WindowState = this.pseudoState;
            const tabStripState: WindowState = this.state;

            PointUtils.assign(pseudoState.center, tabStripState.center);
            PointUtils.assign(pseudoState.halfSize, tabStripState.halfSize);
        }
    }
}
