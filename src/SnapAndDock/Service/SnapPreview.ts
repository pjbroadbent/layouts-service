import {eSnapValidity, SnapTarget} from './Resolver';
import {SnapGroup} from './SnapGroup';
import {SnapWindow, WindowState} from './SnapWindow';
import {Point, PointUtils} from './utils/PointUtils';

const PREVIEW_SUCCESS = '#3D4059';
const PREVIEW_FAILURE = `repeating-linear-gradient(45deg, #3D4059, #3D4059 .25em, #C24629 0, #C24629 .5em)`;

interface PreviewWindow {
    window: fin.OpenFinWindow;
    nativeWindow: Window|null;
    halfSize: Point;
    snapWindow: SnapWindow|null;
}

/**
 * Visual indicator of the current stap target.
 *
 * Will create colored rectangles based on the given group. Rectangle color will be set according to snap validity.
 */
export class SnapPreview {
    /**
     * Ensure we always have a number of free windows available. This should reduce lag when first moving a group.
     */
    private static INITIAL_FREE_WINDOWS = 3;

    private pool: {active: PreviewWindow[]; free: PreviewWindow[]};

    private activeGroup: SnapGroup|null;
    private isValid: boolean;

    constructor() {
        this.pool = {active: [], free: []};

        // Initialise pool with several free windows
        for (let i = 0; i < SnapPreview.INITIAL_FREE_WINDOWS; i++) {
            this.pool.free.push(this.createWindow(null));
        }

        this.activeGroup = null;
        this.isValid = true;
    }

    /**
     * Creates rectangles that match the windows in the given group, but offset by the specified distance.
     *
     * The 'isValid' parameter determines the color of the rectangles. The class also caches the group
     * argument to avoid having to re-create the rectangle objects on every call if the group hasn't changed.
     */
    public show(target: SnapTarget): void {
        const activeGroup = target.activeWindow.getGroup();

        if (this.activeGroup !== activeGroup) {
            this.hide();
        }

        // if (this.activeGroup && this.pool.active.length !== this.activeGroup.windows.length) {
        const activeWindows: PreviewWindow[] = this.pool.active;
        const unusedPreviews: PreviewWindow[] = activeWindows.slice();

        // Ensure a preview window exists for each window in the active group
        activeGroup.windows.forEach((activeWindow: SnapWindow) => {
            const index = unusedPreviews.findIndex((preview: PreviewWindow) => preview.snapWindow === activeWindow);

            if (index === -1) {
                this.getOrCreateWindow(activeWindow);
            } else {
                unusedPreviews.splice(index, 1);
            }
        });
        unusedPreviews.forEach(preview => this.recycleWindow(preview));

        // Ensure each preview window matches it's main window
        activeWindows.forEach((preview: PreviewWindow) => {
            const state: WindowState = preview.snapWindow!.getState();
            const halfSize = target.halfSize && target.activeWindow === preview.snapWindow ? target.halfSize : state.halfSize;

            if (!PointUtils.isEqual(preview.halfSize, halfSize)) {
                this.setWindowSize(preview, halfSize);
            }
            this.setWindowPosition(preview, state.center, state.halfSize, target.snapOffset);
        });

        const isValid = target.validity === eSnapValidity.VALID;
        if (this.isValid !== isValid) {
            this.isValid = isValid;
            this.pool.active.forEach((preview: PreviewWindow) => {
                preview.nativeWindow!.document.body.style.background = isValid ? PREVIEW_SUCCESS : PREVIEW_FAILURE;
            });
        }

        this.activeGroup = activeGroup;
    }

    /**
     * Hides any visible preview windows. The window objects are hidden, but kept in a pool.
     */
    public hide(): void {
        const activeWindows = this.pool.active.slice();

        // Free all windows
        activeWindows.forEach(preview => this.recycleWindow(preview));

        // Reset active group
        this.activeGroup = null;
    }

    private createWindow(snapWindow: SnapWindow|null): PreviewWindow {
        const defaultHalfSize = {x: 160, y: 160};
        const options: fin.WindowOptions = {
            name: 'previewWindow-' + Math.floor(Math.random() * 1000),
            url: 'about:blank',
            defaultWidth: defaultHalfSize.x * 2,
            defaultHeight: defaultHalfSize.y * 2,
            opacity: 0.8,
            minimizable: false,
            maximizable: false,
            defaultTop: -1000,
            defaultLeft: -1000,
            showTaskbarIcon: false,
            frame: false,
            state: 'normal',
            autoShow: false,
            alwaysOnTop: true
        };

        const preview: PreviewWindow = {
            window: new fin.desktop.Window(
                options,
                () => {
                    preview.nativeWindow = preview.window.getNativeWindow();
                    preview.nativeWindow.document.body.style.background = PREVIEW_SUCCESS;
                }),
            nativeWindow: null,
            halfSize: defaultHalfSize,
            snapWindow
        };

        return preview;
    }

    private getOrCreateWindow(snapWindow: SnapWindow): PreviewWindow {
        let preview: PreviewWindow|null = this.pool.free.pop() || null;

        if (preview) {
            preview.snapWindow = snapWindow;
        } else {
            preview = this.createWindow(snapWindow);
        }

        this.pool.active.push(preview);
        preview.window.show();

        return preview;
    }

    private recycleWindow(preview: PreviewWindow): void {
        const activeWindows: PreviewWindow[] = this.pool.active;
        const index = activeWindows.indexOf(preview);

        if (index >= 0) {
            preview.snapWindow = null;
            preview.window.hide();
            activeWindows.splice(index, 1);
            this.pool.free.push(preview);
        } else {
            console.warn('Pool out of sync');
        }
    }

    private setWindowSize(preview: PreviewWindow, halfSize: Point): void {
        // Resize OpenFin window
        preview.window.resizeTo(halfSize.x * 2, halfSize.y * 2, 'top-left');

        // Also update cached halfSize
        PointUtils.assign(preview.halfSize, halfSize);
    }

    private setWindowPosition(preview: PreviewWindow, center: Point, halfSize: Point, snapOffset: Point): void {
        // Move OpenFin window
        preview.window.moveTo(center.x - halfSize.x + snapOffset.x, center.y - halfSize.y + snapOffset.y);

        // preview.window.animate(
        //     {position: {left: center.x - halfSize.x + snapOffset.x, top: center.y - halfSize.y + snapOffset.y, duration: 100}},
        //     {interrupt: true}
        // );
    }
}
