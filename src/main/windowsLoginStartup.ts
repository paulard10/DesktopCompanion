import fs from 'node:fs';
import { app } from 'electron';
import {
  createLoginStartupController,
  type LoginLaunchItem,
  type LoginStartupController,
} from '../shared/windowsLoginStartup.js';

export function createInstalledLoginStartup(dev: boolean, smoke: boolean): LoginStartupController {
  return createLoginStartupController(
    {
      platform: process.platform,
      execPath: process.execPath,
      localAppData: process.env.LOCALAPPDATA,
      dev,
      smoke,
      exists: (candidate) => {
        try {
          return fs.existsSync(candidate);
        } catch {
          return false;
        }
      },
    },
    {
      read: (query) => {
        const result = app.getLoginItemSettings({ path: query.path, args: [...query.args] });
        const launchItems = Array.isArray(result.launchItems) ? result.launchItems : [];
        return {
          openAtLogin: result.openAtLogin === true,
          executableWillLaunchAtLogin: result.executableWillLaunchAtLogin === true,
          launchItems: launchItems.map((item): LoginLaunchItem => ({
            name: item.name,
            path: item.path,
            args: Array.isArray(item.args) ? item.args : [],
            scope: item.scope === 'user' || item.scope === 'machine' ? item.scope : 'other',
            enabled: item.enabled === true,
          })),
        };
      },
      write: (settings) => {
        app.setLoginItemSettings({
          openAtLogin: settings.openAtLogin,
          path: settings.path,
          args: [...settings.args],
          name: settings.name,
          enabled: true,
        });
      },
    },
  );
}
