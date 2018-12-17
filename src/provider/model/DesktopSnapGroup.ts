import {Signal1, Signal2} from '../Signal';
import {CalculatedProperty} from '../snapanddock/utils/CalculatedProperty';
import {Point, PointUtils} from '../snapanddock/utils/PointUtils';

import {DesktopEntity} from './DesktopEntity';
import {DesktopTabGroup} from './DesktopTabGroup';
import {DesktopWindow, EntityState, eTransformType, Mask, WindowIdentity, WindowMessages} from './DesktopWindow';

export class DesktopSnapGroup {
    private static nextId = 1;

    public static readonly onCreated: Signal1<DesktopSnapGroup> = new Signal1();
    public static readonly onDestroyed: Signal1<DesktopSnapGroup> = new Signal1();

    /**
     * A window property has been changed that may snap the window out of any group that it it's currently in.
     *
     * The service should validate the window, to ensure it's current grouping is still valid.
     *
     * Arguments: (group: DesktopSnapGroup, modifiedWindow: DesktopWindow)
     */
    public readonly onModified: Signal2<DesktopSnapGroup, DesktopWindow> = new Signal2();

    /**
     * Window is being moved/resized, need to check for any snap targets.
     *
     * Arguments: (group: DesktopSnapGroup, type: Mask<eTransformType>)
     */
    public readonly onTransform: Signal2<DesktopSnapGroup, Mask<eTransformType>> = new Signal2();

    /**
     * The move/resize operation (that was signalled through onTransform) has been completed.
     *
     * Any active snap target can now be applied.
     *
     * Arguments: (group: DesktopSnapGroup)
     */
    public readonly onCommit: Signal1<DesktopSnapGroup> = new Signal1();

    /**
     * A window has been added to this group.
     *
     * Signal will be fired AFTER all state updates.
     *
     * Arguments: (group: DesktopSnapGroup, window: DesktopWindow)
     */
    public readonly onWindowAdded: Signal2<DesktopSnapGroup, DesktopWindow> = new Signal2();

    /**
     * A window has been removed from this group.
     *
     * Signal will be fired AFTER all state updates.
     *
     * Arguments: (group: DesktopSnapGroup, window: DesktopWindow)
     */
    public readonly onWindowRemoved: Signal2<DesktopSnapGroup, DesktopWindow> = new Signal2();


    // NOTE: The co-ordinates used by _origin and _halfSize use the center of the root window as the origin.
    private _origin: CalculatedProperty<Point>;
    private _halfSize: CalculatedProperty<Point>;

    private _id: number;
    private _entities: DesktopEntity[];
    private _windows: DesktopWindow[];

    private rootWindow: DesktopWindow|null;

    constructor() {
        this._id = DesktopSnapGroup.nextId++;
        this._entities = [];
        this._windows = [];
        this.rootWindow = null;

        const refreshFunc = this.calculateProperties.bind(this);
        this._origin = new CalculatedProperty(refreshFunc);
        this._halfSize = new CalculatedProperty(refreshFunc);

        DesktopSnapGroup.onCreated.emit(this);
    }

    public get id(): number {
        return this._id;
    }

    public get origin(): Readonly<Point> {
        return this._origin.value;
    }

    public get halfSize(): Readonly<Point> {
        return this._halfSize.value;
    }

    public get center(): Point {
        if (this.rootWindow) {
            const origin: Point = this._origin.value;
            const rootCenter: Point = this.rootWindow!.getState().center;

            return {x: rootCenter.x + origin.x, y: rootCenter.y + origin.y};
        } else {
            return {x: 0, y: 0};
        }
    }

    public get length(): number {
        return this._windows.length;
    }

    public get entities(): DesktopEntity[] {
        return this._entities.slice();
    }

    public get windows(): DesktopWindow[] {
        return this._windows.slice();
    }

    public addWindow(window: DesktopWindow): void {
        if (!this._windows.includes(window)) {
            // Remove window from it's previous group
            const prevGroup = (window.getSnapGroup() === this) ? window.getPrevGroup() : window.getSnapGroup();
            if (prevGroup) {
                prevGroup.removeWindow(window);
            }

            // Add listeners to window
            window.onModified.add(this.onWindowModified, this);
            window.onTransform.add(this.onWindowTransform, this);
            window.onCommit.add(this.onWindowCommit, this);
            window.onTeardown.add(this.onWindowTeardown, this);

            // Setup hierarchy
            this._windows.push(window);
            this.buildEntities();
            this.checkRoot();
            if (window.getSnapGroup() !== this) {
                window.setSnapGroup(this);
            }

            // Will need to re-calculate cached properties
            this._origin.markStale();
            this._halfSize.markStale();

            // Inform window of addition
            // Note that client API only considers windows to belong to a group if it contains two or more windows
            if (this._windows.length >= 2) {
                window.sendMessage(WindowMessages.JOIN_SNAP_GROUP, {});
            }

            // Inform service of addition
            this.onWindowAdded.emit(this, window);
        }
    }

    private removeWindow(window: DesktopWindow): void {
        const index: number = this._windows.indexOf(window);

        if (index >= 0) {
            this._windows.splice(index, 1);
            this.buildEntities();

            window.onModified.remove(this.onWindowModified, this);
            window.onTransform.remove(this.onWindowTransform, this);
            window.onCommit.remove(this.onWindowCommit, this);

            // Root may now have changed
            this.checkRoot();

            // Will need to re-calculate cached properties
            this._origin.markStale();
            this._halfSize.markStale();

            // Inform window of removal
            // Note that client API only considers windows to belong to a group if it contains two or more windows
            if (this._windows.length > 0 && window.isReady()) {
                window.sendMessage(WindowMessages.LEAVE_SNAP_GROUP, {});
            }

            // Have the service validate this group, to ensure it hasn't been split into two or more pieces.
            this.onModified.emit(this, window);

            // Inform service of removal
            this.onWindowRemoved.emit(this, window);

            if (this._windows.length === 0) {
                DesktopSnapGroup.onDestroyed.emit(this);
            }
        }
    }

    private buildEntities(): void {
        const entities: DesktopEntity[] = this._entities;

        entities.length = 0;
        this._windows.forEach((window: DesktopWindow) => {
            let entity: DesktopEntity;
            const tabGroup = window.getTabGroup();

            if (tabGroup && tabGroup.tabs.length > 1) {
                entity = tabGroup;
            } else {
                entity = window;
            }

            if (!entities.includes(entity)) {
                entities.push(entity);
            }
        });
    }

    /**
     * Ensures the root is valid. If the group is empty, the root will be null.
     */
    private checkRoot(): void {
        let root = this._windows[0] || null;
        const tabGroup: DesktopTabGroup|null = root && root.getTabGroup();

        // If the root window becomes hidden the group center will stop updating.
        // Tabbed windows are likely to be hidden a large amount of the time, so prefer the tabstrip window as the root.
        if (tabGroup && tabGroup.tabs.length >= 2) {
            root = tabGroup.window;
        }

        if (this.rootWindow !== root) {
            this.rootWindow = root;

            // Since these are measured relative to the root window, they will need updating
            this._origin.markStale();
            this._halfSize.markStale();
        }
    }

    private onWindowModified(window: DesktopWindow): void {
        this._origin.markStale();
        this._halfSize.markStale();
        this.onModified.emit(this, window);
    }

    private onWindowTransform(window: DesktopWindow, type: Mask<eTransformType>): void {
        if (type === eTransformType.MOVE) {
            // When a grouped window is moved, all windows in the group will fire a move event.
            // We want to filter these to ensure the group only fires onTransform once
            this.onTransform.emit(this, type);
        } else {
            // If a window is resized, that event will only ever fire from that one window. Safe to re-broadcast at the group level.
            this.onTransform.emit(this, type);
        }

        if ((type & eTransformType.RESIZE) !== 0) {
            // The group's bounding box MAY have changed (if the resized window was, or is now, on the edge of the group)
            // No way to tell for sure, so will need to re-calculate bounds regardless, to be safe.
            this._origin.markStale();
            this._halfSize.markStale();
        }
    }

    private onWindowCommit(window: DesktopWindow, type: Mask<eTransformType>): void {
        this.onCommit.emit(this);
    }

    private onWindowTeardown(window: DesktopWindow) {
        const group: DesktopSnapGroup = window.getSnapGroup();

        // Ensure window is removed from it's snap group, so that the group doesn't contain any de-registered or non-existant windows.
        group.removeWindow(window);
    }

    private calculateProperties(): void {
        let windows: DesktopWindow[] = this._windows;
        let numWindows: number = windows.length;

        if (windows.length > 1) {
            windows = windows.filter((window: DesktopWindow) => {
                const state = window.getState();
                return !state.hidden && state.state === 'normal';
            });
            numWindows = windows.length;
        }

        if (numWindows === 0) {
            this._origin.updateValue({x: 0, y: 0});
            this._halfSize.updateValue({x: 0, y: 0});
        } else if (numWindows === 1) {
            this._origin.updateValue({x: 0, y: 0});
            this._halfSize.updateValue(PointUtils.clone(this.rootWindow!.getState().halfSize));
        } else {
            let state: EntityState = windows[0].getState();
            const min: Point = {x: state.center.x - state.halfSize.x, y: state.center.y - state.halfSize.y};
            const max: Point = {x: state.center.x + state.halfSize.x, y: state.center.y + state.halfSize.y};

            for (let i = 1; i < numWindows; i++) {
                state = windows[i].getState();

                min.x = Math.min(min.x, state.center.x - state.halfSize.x);
                min.y = Math.min(min.y, state.center.y - state.halfSize.y);
                max.x = Math.max(max.x, state.center.x + state.halfSize.x);
                max.y = Math.max(max.y, state.center.y + state.halfSize.y);
            }

            const rootPosition: Point = this.rootWindow!.getState().center;
            this._origin.updateValue({x: ((min.x + max.x) / 2) - rootPosition.x, y: ((min.y + max.y) / 2) - rootPosition.y});
            this._halfSize.updateValue({x: (max.x - min.x) / 2, y: (max.y - min.y) / 2});
        }
    }
}
