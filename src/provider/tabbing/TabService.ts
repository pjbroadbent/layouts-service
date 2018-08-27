import {ApplicationUIConfig, Bounds, TabIdentifier, TabWindowOptions} from '../../client/types';
import {Signal1} from '../snapanddock/Signal';
import {APIHandler} from './APIHandler';
import {DragWindowManager} from './DragWindowManager';
import {EventHandler} from './EventHandler';
import {Tab} from './Tab';
import {TabAPIActionProcessor} from './TabAPIActionProcessor';
import {TabGroup} from './TabGroup';
import {ZIndexer} from './ZIndexer';

interface GroupTabBounds extends Bounds {
    group: TabGroup;
}

/**
 * The overarching class for the Tab Service.
 */
export class TabService {
    /**
     * Handle of this Tab Service Instance.
     */
    public static INSTANCE: TabService;

    /**
     * Indicates that a new tab group has been created. This happens as the result of a user action that tabs two or
     * more windows together. A tab group will only ever be created if there are at least two windows that need to be
     * tabbed together.
     *
     * NOTE: At the point where this signal is dispatched the group will be empty. It will not be possible to determine
     * which window(s) caused the creation of the tab group just from listening to this signal.
     */
    public readonly tabGroupAdded: Signal1<TabGroup> = new Signal1();
    
    /**
     * Indicates that a new tab group has been removed from the service. This happens whenever a tab set is left with 
     * fewer than two tabs. A tab group requires that there are always at least two windows within the tab group.
     *
     * NOTE: At the point where this signal is dispatched the group will be empty. It will not be possible to determine
     * which window(s) were previously in the tab group just from listening to this signal.
     */
    public readonly tabGroupRemoved: Signal1<TabGroup> = new Signal1();

    /**
     * Handle to the Tabbing API Handler
     */
    public apiHandler: APIHandler;

    /**
     * Contains all the tabsets of this service.
     */
    private _tabGroups: TabGroup[];

    /**
     * Handle to the AppApi Handler.
     */
    private _eventHandler: EventHandler;

    /**
     * Handle to the TabAPIActionProcessor
     */
    private mTabApiEventHandler: TabAPIActionProcessor;

    /**
     * Handle to the DragWindowManager
     */
    private _dragWindowManager: DragWindowManager;

    /**
     * Handle to the ZIndexer
     */
    private _zIndexer: ZIndexer = new ZIndexer();

    private _applicationUIConfigurations: ApplicationUIConfig[];


    /**
     * Constructor of the TabService Class.
     */
    constructor() {
        this._tabGroups = [];
        this._applicationUIConfigurations = [];
        this._dragWindowManager = new DragWindowManager();
        this._dragWindowManager.init();

        this._eventHandler = new EventHandler(this);
        this.apiHandler = new APIHandler(this);

        this.mTabApiEventHandler = new TabAPIActionProcessor(this);
        this.mTabApiEventHandler.init();

        TabService.INSTANCE = this;
    }

    public getAppUIConfig(uuid: string) {
        const conf = this._applicationUIConfigurations.find(config => config.uuid === uuid);

        if (conf) {
            return conf.config;
        }

        return;
    }

    public addAppUIConfig(uuid: string, config: TabWindowOptions) {
        if (!this.getAppUIConfig(uuid)) {
            this._applicationUIConfigurations.push({uuid, config});
        }
    }

    /**
     * Creates a new tab group
     * @param {TabWindowOptions} WindowOptions Window Options used to create the tab group window (positions, dimensions, url, etc...)
     * @returns {TabGroup} TabGroup
     */
    public async addTabGroup(windowOptions: TabWindowOptions): Promise<TabGroup> {
        const group = new TabGroup(windowOptions);
        // await group.init();

        this._tabGroups.push(group);
        this.tabGroupAdded.emit(group);

        return group;
    }

    /**
     * Removes the tab group from the service and optionally closes all the groups tab windows.
     * @param ID ID of the tab group to remove.
     * @param closeApps Flag if we should close the groups tab windows.
     */
    public async removeTabGroup(ID: string, closeApps: boolean): Promise<void> {
        const groupIndex = this._getGroupIndex(ID);

        if (groupIndex !== -1) {
            const group = this._tabGroups[groupIndex];

            await group.removeAllTabs(closeApps);
            await group.window.close(true);

            this._tabGroups.splice(groupIndex, 1);
            this.tabGroupRemoved.emit(group);
        }
    }

    /**
     * Returns a tab group searched by its ID.
     * @param ID ID of the tab group to find.
     * @returns {TabGroup | undefined} TabGroup
     */
    public getTabGroup(ID: string): TabGroup|undefined {
        return this._tabGroups.find((group: TabGroup) => {
            return group.ID === ID;
        });
    }

    /**
     * Returns a tab group searched by a tab it contains.
     * @param ID ID of the tab group to find.
     * @returns {TabGroup | undefined} Tabgroup
     */
    public getTabGroupByApp(ID: TabIdentifier): TabGroup|undefined {
        return this._tabGroups.find((group: TabGroup) => {
            return group.tabs.some((tab: Tab) => {
                const tabID = tab.ID;
                return tabID.name === ID.name && tabID.uuid === ID.uuid;
            });
        });
    }

    /**
     * Returns an individual Tab.
     * @param ID ID of the tab to get.
     */
    public getTab(ID: TabIdentifier): Tab|undefined {
        const group = this.getTabGroupByApp(ID);

        if (group) {
            return group.getTab(ID);
        }

        return;
    }

    /**
     * Creates a new tab group with provided tabs.  Will use the UI and position of the first Identity provided for positioning.
     * @param tabs An array of Identities to add to a group.
     */
    public async createTabGroupWithTabs(tabs: TabIdentifier[]) {
        if (tabs.length === 0) {
            return Promise.reject('Must provide at least 1 Tab Identifier');
        }
        const group = await this.addTabGroup({});


        for (const tab of tabs) {
            await group.addTab({tabID: tab});
        }

        group.realignApps();

        return;
    }

    /**
     * Checks for any windows that is under a specific point.
     * @param {number} x X Coordinate
     * @param {number} y Y Coordinate
     * @returns {TabGroup | null}
     */
    public async isPointOverTabGroup(x: number, y: number): Promise<TabGroup|null> {
        const groupTabBounds = await Promise.all(this._tabGroups.map(async group => {
            const activeTabBoundsP = group.activeTab.window.getWindowBounds();
            const groupBoundsP = group.window.getWindowBounds();
            const activeTabShowingP = group.activeTab.window.isShowing();

            const [activeTabBounds, groupBounds, activeTabShowing] = await Promise.all([activeTabBoundsP, groupBoundsP, activeTabShowingP]);

            if (!activeTabShowing) {
                return;
            }

            return {group, top: groupBounds.top!, left: groupBounds.left!, width: groupBounds.width!, height: groupBounds.height! + activeTabBounds.height!};
        }));

        const result: GroupTabBounds[] = groupTabBounds.filter((group): group is GroupTabBounds => {
            if (!group) {
                return false;
            }

            return x > group.left && x < group.width + group.left && y > group.top && y < group.top + group.height;
        });

        if (result) {
            const topOrdered = this._zIndexer.getTop(result.map(group => {
                return {uuid: group.group.activeTab.ID.uuid, name: group.group.activeTab.ID.name};
            }));

            if (topOrdered) {
                const f = result.find(g => {
                    return g.group.activeTab.ID.uuid === topOrdered[0].uuid && g.group.activeTab.ID.name === topOrdered[0].name;
                });

                if (f) {
                    return f.group;
                }
            }
        }

        return null;
    }

    /**
     * Returns the array index of a tab group.
     * @param ID ID of the tab group to search.
     * @returns {number} Index number.
     */
    private _getGroupIndex(ID: string): number {
        return this._tabGroups.findIndex((tab: TabGroup) => {
            return tab.ID === ID;
        });
    }

    /**
     * Returns the DragWindowManager instance.
     * @returns {DragWindowManager} DragWindowManager
     */
    public get dragWindowManager(): DragWindowManager {
        return this._dragWindowManager;
    }

    /**
     * Returns the Tab Group Array
     * @returns {TabGroup[]} Tab Groups Array
     */
    public get tabGroups(): TabGroup[] {
        return this._tabGroups;
    }
}
