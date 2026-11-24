import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { resolveTrayIcon } from '../shared/packagedLayout.js';
import { loginStartupMenuItem } from '../shared/windowsLoginStartup.js';

export interface CompanionTray {
  destroy: () => void;
  refresh: () => void;
}

export function createTray(options: {
  onShow: () => void;
  onHide: () => void;
  onWake: () => void;
  onSleep: () => void;
  onOpenChat: () => void;
  onAskCopied?: () => void;
  onToggleRecoveryCapture: (enabled: boolean) => void;
  isRecoveryCapture: () => boolean;
  isWandering: () => boolean;
  isTrail: () => boolean;
  isStartAwake: () => boolean;
  onStartAwake?: (enabled: boolean) => void;
  isAutonomous?: () => boolean;
  onAutonomous?: (enabled: boolean) => void;
  isReducedMotion?: () => boolean;
  onReducedMotion?: (enabled: boolean) => void;
  movementSpeed?: () => 'calm' | 'normal' | 'lively';
  onMovementSpeed?: (speed: 'calm' | 'normal' | 'lively') => void;
  startupAvailable: boolean;
  isStartWithWindows: () => boolean;
  onStartWithWindows?: (enabled: boolean) => void;
  devMovement?: boolean;
  devMarker?: boolean;
  isFollowing?: () => boolean;
  onFollow?: (enabled: boolean) => void;
  isHome?: () => boolean;
  onHome?: (enabled: boolean) => void;
  onMove?: (direction: 'left' | 'right' | 'up' | 'down' | 'home' | 'stop') => void;
  onMoveTest?: () => void;
  onWander?: (enabled: boolean) => void;
  onTrail?: (action: 'enable' | 'disable' | 'reset' | 'marker') => void;
  onQuit: () => void;
  onSelectScreenArea?: () => void;
}): CompanionTray {
  const tray = new Tray(loadTrayImage());
  tray.setToolTip('Desktop Companion');

  const refresh = (): void => {
    tray.setContextMenu(buildMenu());
  };

  const buildMenu = (): Menu => {
    const startup = loginStartupMenuItem(
      options.startupAvailable,
      options.startupAvailable ? options.isStartWithWindows() : false,
    );
    const template: MenuItemConstructorOptions[] = [
      { label: 'Show', click: options.onShow },
      { label: 'Hide', click: options.onHide },
      { type: 'separator' },
      { label: 'Wake', click: options.onWake },
      { label: 'Sleep', click: options.onSleep },
      { label: 'Open Chat', click: options.onOpenChat },
      ...(options.onAskCopied
        ? [{ label: 'Ask about copied text', click: options.onAskCopied }]
        : []),
      { type: 'separator' },
      {
        label: 'Movement',
        submenu: [
          { label: 'Move Up', click: () => options.onMove?.('up') },
          { label: 'Move Down', click: () => options.onMove?.('down') },
          { label: 'Move Left', click: () => options.onMove?.('left') },
          { label: 'Move Right', click: () => options.onMove?.('right') },
          { label: 'Return Home', click: () => options.onMove?.('home') },
          { label: 'Stop movement', click: () => options.onMove?.('stop') },
        ],
      },
      {
        label: 'Wandering',
        type: 'checkbox',
        checked: options.isWandering(),
        click: (item) => {
          options.onWander?.(Boolean(item.checked));
          refresh();
        },
      },
      {
        label: 'Neon Trail',
        type: 'checkbox',
        checked: options.isTrail(),
        click: (item) => {
          options.onTrail?.(item.checked ? 'enable' : 'disable');
          refresh();
        },
      },
      {
        label: 'Follow Cursor',
        type: 'checkbox',
        checked: options.isFollowing?.() ?? false,
        click: (item) => {
          options.onFollow?.(Boolean(item.checked));
          refresh();
        },
      },
      {
        label: 'Autonomous Movement',
        type: 'checkbox',
        checked: options.isAutonomous?.() ?? true,
        click: (item) => {
          options.onAutonomous?.(Boolean(item.checked));
          refresh();
        },
      },
      {
        label: 'Show Home',
        type: 'checkbox',
        checked: options.isHome?.() ?? false,
        click: (item) => {
          options.onHome?.(Boolean(item.checked));
          refresh();
        },
      },
      { label: 'Hide Home', enabled: options.isHome?.() ?? false, click: () => { options.onHome?.(false); refresh(); } },
      ...(options.onSelectScreenArea
        ? [{ label: 'Select Screen Area', click: options.onSelectScreenArea }]
        : []),
      {
        label: 'Preferences',
        submenu: [
          {
            label: 'Reduced Motion',
            type: 'checkbox',
            checked: options.isReducedMotion?.() ?? false,
            click: (item) => {
              options.onReducedMotion?.(Boolean(item.checked));
              refresh();
            },
          },
          {
            label: 'Movement Speed',
            submenu: (['calm', 'normal', 'lively'] as const).map((speed) => ({
              label: speed === 'calm' ? 'Calm' : speed === 'lively' ? 'Lively' : 'Normal',
              type: 'radio' as const,
              checked: (options.movementSpeed?.() ?? 'normal') === speed,
              click: () => {
                options.onMovementSpeed?.(speed);
                refresh();
              },
            })),
          },
          {
            label: startup.label,
            type: startup.type,
            checked: startup.checked,
            enabled: startup.enabled,
            click: (item) => {
              if (!startup.enabled) {
                return;
              }
              options.onStartWithWindows?.(Boolean(item.checked));
              refresh();
            },
          },
        ],
      },
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
      ...(options.devMovement
        ? [
            { type: 'separator' as const },
            { label: 'Test window move', click: () => options.onMoveTest?.() },
            { label: 'Reset Trail', click: () => options.onTrail?.('reset') },
            ...(options.devMarker
              ? [{ label: 'Show Trail Marker', click: () => options.onTrail?.('marker') }]
              : []),
          ]
        : []),
      { type: 'separator' },
      { label: 'Quit', click: options.onQuit },
    ];
    return Menu.buildFromTemplate(template);
  };

  tray.on('click', () => {
    refresh();
  });
  tray.on('right-click', () => {
    refresh();
  });
  refresh();
  return {
    destroy: () => tray.destroy(),
    refresh,
  };
}

function loadTrayImage(): NativeImage {
  const iconPath = resolveTrayIcon(__dirname);
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    throw new Error(`Tray icon missing or unreadable: ${iconPath}`);
  }
  return image;
}
