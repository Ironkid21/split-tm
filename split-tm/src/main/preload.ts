import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { SplitTmApi } from '../shared/api';

const api: SplitTmApi = {
  info: () => ipcRenderer.invoke('info'),
  upgradeNotice: () => ipcRenderer.invoke('upgradeNotice'),
  pickFiles: () => ipcRenderer.invoke('pickFiles'),
  pathForFile: (f) => webUtils.getPathForFile(f),
  scan: (paths) => ipcRenderer.invoke('scan', paths),
  count: (filter) => ipcRenderer.invoke('count', filter),
  preview: (filter) => ipcRenderer.invoke('preview', filter),
  process: (filter, format, mode, marketMode) => ipcRenderer.invoke('process', filter, format, mode, marketMode),
  closeApp: () => ipcRenderer.invoke('closeApp'),
  chooseOutputRoot: () => ipcRenderer.invoke('chooseOutputRoot'),
  openPath: (p) => ipcRenderer.invoke('openPath', p),
  onProgress: (cb) => {
    const h = (_e: unknown, p: Parameters<typeof cb>[0]) => cb(p);
    ipcRenderer.on('progress', h);
    return () => ipcRenderer.removeListener('progress', h);
  },
};
contextBridge.exposeInMainWorld('splitTM', api);
