import {TabBlob, TabIdentifier} from '../../client/types';
import {Tab} from './Tab';
import {TabGroup} from './TabGroup';
import {TabService} from './TabService';
import {createTabGroupsFromTabBlob} from './TabUtilities';

/**
 * Gathers information from tab sets and their tabs, and returns as a JSON object back to the requesting application/window.
 * @param uuid Uuid of the requesting Application
 * @param name Name of the requesting window
 * @returns {TabBlob[] | undefined} Returns undefined if a tab service is not around.
 */
export async function getTabSaveInfo(): Promise<TabBlob[]|undefined> {
    if (!TabService.INSTANCE) {
        console.error('No Tab Service!');
        return;
    }

    return Promise.all(TabService.INSTANCE.tabGroups.map(async (group: TabGroup) => {
        const tabs: TabIdentifier[] = group.tabs.map((tab: Tab) => {
            return tab.ID;
        });

        const [groupBounds, appBounds] = await Promise.all([group.window.getWindowBounds(), group.activeTab.window.getWindowBounds()]);

        const groupInfo = {
            url: group.window.initialWindowOptions.url!,
            active: group.activeTab.ID,
            dimensions:
                {x: groupBounds.left!, y: groupBounds.top!, width: groupBounds.width!, tabGroupHeight: groupBounds.height!, appHeight: appBounds.height!}
        };

        return {tabs, groupInfo};
    }));
}


/**
 * Swaps an existing tab in a tab group with a new tab.  This will keep the original tabs index.
 * @param {TabIdentifier} add The new window to add into the group
 * @param {TabIdentifier} swapWith The existing window in the group
 */
export async function swapTab(add: TabIdentifier, swapWith: TabIdentifier) {
    if (!TabService.INSTANCE) {
        console.error('No running instance of TabService found');
        return;
    }

    const group = TabService.INSTANCE.getTabGroupByApp(swapWith);

    if (!group) {
        console.error(`No tab group found for ${swapWith}`);
        return;
    }

    const tabIndex = group.getTabIndex(swapWith);

    const tab: Tab = new Tab({tabID: add});
    await tab.init();
    await group.addTab(tab, false, true, tabIndex);

    // remove swap with tab, dont close app, dont switch tabs, dont close group window
    await group.removeTab(swapWith, false, false, false, false);

    if (group.activeTab && group.activeTab.ID.uuid === swapWith.uuid && group.activeTab.ID.name === swapWith.name) {
        // if the switchedwith tab was the active one, we make the added tab active
        group.switchTab(add);
    } else {
        // else we hide it because the added tab might be visible.
        tab!.window.hide();
    }

    return;
}

/**
 * Removes a tab from a tab group.
 * @param {TabIdentifier} tabID The identity of the tab to remove.
 */
export async function removeTab(tabID: TabIdentifier) {
    if (!TabService.INSTANCE) {
        return Promise.reject('No Tab Service!');
    }

    const group = TabService.INSTANCE.getTabGroupByApp(tabID);

    if (!group) {
        return;
    }

    // remove tab, dont close app, close tab strip when empty, switch tab to other tab, restore window state when leaving.
    await group.removeTab(tabID, false, true, false, true);

    return;
}

/**
 * Restores tabs and tab groups using the given tab blob information.
 * @param {TabBlob[]} tabBlob Array of TabBlobs
 */
export function restoreTabs(tabBlob: TabBlob[]): Promise<void> {
    if (!TabService.INSTANCE) {
        console.error('No running instance of TabService found');
        throw new Error('No running instance of TabService found');
    }

    return createTabGroupsFromTabBlob(tabBlob);
}