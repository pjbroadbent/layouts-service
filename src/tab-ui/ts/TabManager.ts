import { Tab, TabIndentifier } from "./Tab";

/**
 * @class TabManager Handles the management of individual tabs and some of their functionality.
 */
export class TabManager {
	/**
	 * @member INSTANCE Holds the instance for the class.
	 */
	private static INSTANCE: TabManager;

	/**
	 * @method tabs An array of the tabs present in the window.
	 */
	private tabs: Tab[] = [];

	/**
	 * @method activeTab The currently active tab (highlighted).
	 */
	private activeTab: Tab | null = null;

	/**
	 * @method tabContainer The HTML Element container for the tabs.
	 */
	private tabContainer: HTMLElement = document.getElementById("tabs")!;

	/**
	 * @constructor Constructs the TabManager class.
	 */
	constructor() {
		if (TabManager.INSTANCE) {
			return TabManager.INSTANCE;
		}

		TabManager.INSTANCE = this;
	}

	/**
	 * @method addTab Creates a new Tab and renders.
	 * @param {TabIndentifier} tabID An object containing the uuid, name for the external application/window.
	 */
	public addTab(tabID: TabIndentifier): void {
		if (this._getTabIndex(tabID) === -1) {
			this.tabs.push(new Tab(tabID));
		}
	}

	/**
	 * @method removeTab Removes a Tab.
	 * @param {TabIndentifier} tabID An object containing the uuid, name for the external application/window.
	 */
	public removeTab(tabID: TabIndentifier): void {
		const index: number = this._getTabIndex(tabID);
		const tab: Tab | undefined = this.getTab(tabID);

		if (tab && index !== -1) {
			tab.remove();
			this.tabs.splice(index, 1);

			if (this.activeTab === tab) {
				this.unsetActiveTab();
				this.setActiveTab();
			}
		}
	}

	/**
	 * @method unsetActiveTab Removes the active status from the current active Tab.
	 */
	public unsetActiveTab(): void {
		if (!this.activeTab) {
			return;
		}

		this.activeTab.unsetActive();
	}

	/**
	 * @method setActive Sets a specified tab as active.  If no tab is specified then the first tab will be chosen.
	 * @param {TabIndentifier | null} tabID An object containing the uuid, name for the external application/window or null.
	 */
	public setActiveTab(tabID: TabIndentifier | null = null): void {
		if (tabID) {
			const tab: Tab | undefined = this.getTab(tabID);

			if (tab) {
				this.unsetActiveTab();

				tab.setActive();
				this.activeTab = tab;
			} else {
				tabID = null;
			}
		}

		if (!tabID) {
			if (this.tabs.length > 0) {
				this.setActiveTab({
					name: this.tabs[0].getWindowName,
					uuid: this.tabs[0].getAppUuid
				});
			}
		}
	}

	/**
	 * @method getTab Finds and gets the Tab object.
	 * @param {TabIndentifier} tabID An object containing the uuid, name for the external application/window.
	 */
	public getTab(tabID: TabIndentifier): Tab | undefined {
		return this.tabs.find((tab: Tab) => {
			return tab.getWindowName === tabID.name && tab.getAppUuid === tabID.uuid;
		});
	}

	/**
	 * @method _getTabIndex Gets the Tab index from the array.
	 * @param {TabIndentifier} tabID An object containing the uuid, name for the external application/window.
	 */
	private _getTabIndex(tabID: TabIndentifier): number {
		return this.tabs.findIndex((tab: Tab) => {
			return tab.getWindowName === tabID.name && tab.getAppUuid === tabID.uuid;
		});
	}

	/**
	 * @method getTabs Returns an array of all the tabs.
	 * @returns {Tab[]}
	 */
	public get getTabs(): Tab[] {
		return this.tabs;
	}

	/**
	 * @method instance Returns the instance for the class.
	 */
	public static get instance() {
		if (TabManager.INSTANCE) {
			return TabManager.INSTANCE;
		} else {
			return new TabManager();
		}
	}
}
