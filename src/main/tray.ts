import path from 'node:path';
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';

export function createTray(options: {
  onShow: () => void;
  onHide: () => void;
  onWake: () => void;
  onSleep: () => void;
  onOpenChat: () => void;
  onToggleRecoveryCapture: (enabled: boolean) => void;
  isRecoveryCapture: () => boolean;
  devMovement?: boolean;
  devMarker?: boolean;
  onMove?: (direction: 'left' | 'right' | 'up' | 'down' | 'home' | 'stop') => void;
  onMoveTest?: () => void;
  onWander?: (enabled: boolean) => void;
  onTrail?: (action: 'enable' | 'disable' | 'reset' | 'marker') => void;
  onQuit: () => void;
}): Tray {
  const tray = new Tray(loadTrayImage());
  tray.setToolTip('Desktop Companion');

  const refresh = (): void => {
    tray.setContextMenu(buildMenu());
  };

  const buildMenu = (): Menu => {
    const template: MenuItemConstructorOptions[] = [
      { label: 'Show', click: options.onShow },
      { label: 'Hide', click: options.onHide },
      { type: 'separator' },
      { label: 'Wake', click: options.onWake },
      { label: 'Sleep', click: options.onSleep },
      { label: 'Open Chat', click: options.onOpenChat },
      { type: 'separator' },
      {
        label: 'Recovery: capture whole window',
        type: 'checkbox',
        checked: options.isRecoveryCapture(),
        click: (item) => {
          options.onToggleRecoveryCapture(Boolean(item.checked));
          refresh();
        },
      },
      { type: 'separator' },
      ...(options.devMovement
        ? [
            { label: 'Move left', click: () => options.onMove?.('left') },
            { label: 'Move right', click: () => options.onMove?.('right') },
            { label: 'Move up', click: () => options.onMove?.('up') },
            { label: 'Move down', click: () => options.onMove?.('down') },
            { label: 'Return home', click: () => options.onMove?.('home') },
            { label: 'Stop movement', click: () => options.onMove?.('stop') },
            { label: 'Test window move', click: () => options.onMoveTest?.() },
            { type: 'separator' as const },
            { label: 'Enable Wandering', click: () => options.onWander?.(true) },
            { label: 'Disable Wandering', click: () => options.onWander?.(false) },
            { type: 'separator' as const },
            { label: 'Enable Neon Trail', click: () => options.onTrail?.('enable') },
            { label: 'Disable Neon Trail', click: () => options.onTrail?.('disable') },
            { label: 'Reset Trail', click: () => options.onTrail?.('reset') },
            ...(options.devMarker
              ? [{ label: 'Show Trail Marker', click: () => options.onTrail?.('marker') }]
              : []),
            { type: 'separator' as const },
          ]
        : []),
      { label: 'Quit', click: options.onQuit },
    ];
    return Menu.buildFromTemplate(template);
  };

  refresh();
  return tray;
}

function loadTrayImage(): NativeImage {
  const iconPath = path.join(__dirname, '../../assets/tray.png');
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    throw new Error(`Tray icon missing or unreadable: ${iconPath}`);
  }
  return image;
}
