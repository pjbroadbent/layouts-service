import {Tab} from '../tabbing/Tab';
import {TabGroup} from '../tabbing/TabGroup';
import {SnapGroup} from './SnapGroup';
import {SnapWindow, WindowState} from './SnapWindow';


/**
 * A representation of a tab group (created/managed/owned by the tabbing service) within the snapping service.
 *
 * This will eventually be merged with TabGroup, so that there is only one such representation of a tab set within the
 * service.
 */
export class SnapTabSet extends SnapWindow {
    private tabGroup: TabGroup;
    private tabs: SnapWindow[];

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

        // Hack: Asynchronously query for "real" window state, to replace the hard-coded fake window state
        setTimeout(() => {  // Hack: Need to wait for window to initialise
            SnapWindow.getWindowState(window);
        }, 500);
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
            window.clearTabSet();
        } else {
            console.warn('Attempting to add a tab that already exists within tab set', tab);
        }
    }
}
