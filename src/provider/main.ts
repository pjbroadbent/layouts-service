import {APIHandler} from './APIHandler';
import {DesktopModel} from './model/DesktopModel';
import {DesktopWindow, DragMode} from './model/DesktopWindow';
import {SnapService} from './snapanddock/SnapService';
import {win10Check} from './snapanddock/utils/platform';
import {TabService} from './tabbing/TabService';

export let model: DesktopModel;
export let snapService: SnapService;
export let tabService: TabService;
export let apiHandler: APIHandler;

declare const window: Window&{
    model: DesktopModel;
    snapService: SnapService;
    tabService: TabService;

    apiHandler: APIHandler;
};

fin.desktop.main(main);

function getParameter(paramName: string) {
    const searchString = window.location.search.substring(1);
    const params = searchString.split('&');
    let i, val;

    for (i = 0; i < params.length; i++) {
        val = params[i].split('=');
        if (val[0] === paramName) {
            return val[1];
        }
    }
    return null;
}

export async function main() {
    model = window.model = new DesktopModel();
    snapService = window.snapService = new SnapService(model);
    tabService = window.tabService = new TabService(model);
    apiHandler = window.apiHandler = new APIHandler();

    fin.desktop.InterApplicationBus.subscribe('*', 'layoutsService:experimental:disableTabbing', (message, uuid, name) => {
        tabService.disableTabbingOperations = message;
    });
    fin.desktop.InterApplicationBus.subscribe('*', 'layoutsService:experimental:dragEventEmulation', (message, uuid, name) => {
        DesktopWindow.dragMode = (DragMode[message.toString().toUpperCase()] || DragMode.NORMAL) as DragMode;
        console.log(`Setting drag emulation mode to ${DragMode[DesktopWindow.dragMode]} (via IAB message)`);
    });

    fin.desktop.Application.getCurrent().addEventListener('run-requested', (event) => {
        if (event.userAppConfigArgs && event.userAppConfigArgs.disableTabbingOperations) {
            tabService.disableTabbingOperations = event.userAppConfigArgs.disableTabbingOperations ? true : false;
        }
        if (event.userAppConfigArgs && event.userAppConfigArgs.dragEventEmulation) {
            DesktopWindow.dragMode = (DragMode[event.userAppConfigArgs.dragEventEmulation.toString().toUpperCase()] || DragMode.NORMAL) as DragMode;
            console.log(`Setting drag emulation mode to ${DragMode[DesktopWindow.dragMode]} (via run-requested)`);
        }
    });

    tabService.disableTabbingOperations = getParameter('disableTabbingOperations') ? true : false;
    type DragModes = 'NORMAL'|'PREVIEW_ONLY'|'PREVIEW_AND_WINDOW';  // TypeScript doesn't seem to support 'keyof <type>' with enums
    const initialDragEventEmulation: DragModes = (getParameter('dragEventEmulation') || '').toString().toUpperCase() as DragModes;
    if (initialDragEventEmulation) {
        DesktopWindow.dragMode = DragMode[initialDragEventEmulation];
        console.log(`Setting drag emulation mode to ${DragMode[DesktopWindow.dragMode]} (via initial param)`);
        console.log(DesktopWindow.dragMode);
    } else {
        fin.System.readRegistryValue('HKEY_CURRENT_USER', 'Control Panel\\Desktop', 'DragFullWindows').then((response) => {
            if (DesktopWindow.dragMode === DragMode.NORMAL && response.data === '0') {
                DesktopWindow.dragMode = DragMode.PREVIEW_AND_WINDOW;
                console.log(`Setting drag emulation mode to ${DragMode[DesktopWindow.dragMode]} (via registry)`);
            } else {
                console.log(`No change to drag emulation mode: ${DragMode[DesktopWindow.dragMode]} (via registry)`);
            }
        });
    }

    await win10Check;
    await apiHandler.register();
}
