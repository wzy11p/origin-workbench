// Modified for Origin Workbench, 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { APP_DISPLAY_NAME, APP_MONOGRAM } from '@/common/branding';
import React from 'react';

// Mirror the project convention: t() echoes the key so labels/tooltips are assertable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}));

// react-router-dom: control location, capture navigate.
const navigate = vi.fn();
let currentPathname = '/guid';
const platformMocks = vi.hoisted(() => ({
  isElectronDesktopMock: vi.fn(() => false),
}));
const shortcutMocks = vi.hoisted(() => ({
  params: undefined as undefined | { toggleSider: () => void },
}));
const featureMocks = vi.hoisted(() => ({
  teamModeEnabled: false,
  discontinuedBuild: false,
}));
const updateMocks = vi.hoisted(() => ({
  restoreDownloaded: vi.fn(),
  consumeInstallerFailure: vi.fn(),
  check: vi.fn(),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: currentPathname, search: '', hash: '' }),
  useNavigationType: () => 'POP',
  Outlet: () => null,
}));

// Hidden devtools easter-egg target (icon) — assert it is independent of navigation.
const openDevTools = vi.fn(() => Promise.resolve());
vi.mock('@/common', () => ({
  ipcBridge: {
    application: {
      openDevTools: { invoke: () => openDevTools() },
      logStream: { on: () => () => {} },
    },
    task: { stopAll: { invoke: () => Promise.resolve({ success: false }) } },
    autoUpdate: {
      restoreDownloaded: { invoke: updateMocks.restoreDownloaded },
      status: { on: () => () => {} },
    },
    update: {
      check: { invoke: updateMocks.check },
      consumeInstallerLastFailure: { invoke: updateMocks.consumeInstallerFailure },
      open: { on: () => () => {} },
      downloadProgress: { on: () => () => {} },
    },
  },
}));

// Trim Layout's collaborators to keep this a focused brand-behaviour test.
vi.mock('@/common/config/constants', () => ({
  get TEAM_MODE_ENABLED() {
    return featureMocks.teamModeEnabled;
  },
}));
vi.mock('@/renderer/components/layout/PwaPullToRefresh', () => ({ default: () => null }));
vi.mock('@/renderer/components/layout/Titlebar', () => ({ default: () => null }));
vi.mock('@/renderer/components/Markdown', () => ({ default: () => null }));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', fontScale: 1 }),
}));
vi.mock('@/renderer/utils/discontinuedBuild', () => ({
  get IS_DISCONTINUED_BUILD() {
    return featureMocks.discontinuedBuild;
  },
}));
vi.mock('@renderer/hooks/system/useDeepLink', () => ({ useDeepLink: () => {} }));
vi.mock('@renderer/hooks/system/notification/useNotificationClick', () => ({ useNotificationClick: () => {} }));
vi.mock('@renderer/hooks/system/notification/useBrowserNotification', () => ({ useBrowserNotification: () => {} }));
vi.mock('@renderer/hooks/file/useDirectorySelection', () => ({
  useDirectorySelection: () => ({ contextHolder: null }),
}));
vi.mock('@renderer/utils/ui/siderTooltip', () => ({ cleanupSiderTooltips: () => {} }));
vi.mock('@renderer/hooks/ui/useConversationShortcuts', () => ({
  useConversationShortcuts: (params: { toggleSider: () => void }) => {
    shortcutMocks.params = params;
  },
}));
vi.mock('@renderer/utils/platform', () => ({ isElectronDesktop: platformMocks.isElectronDesktopMock }));
vi.mock('@renderer/pages/conversation/Preview/context/PreviewContext', () => ({
  usePreviewContext: () => ({ closePreview: () => {} }),
}));

import Layout from '@renderer/components/layout/Layout';

const renderLayout = () => render(<Layout sider={<div>sider</div>} />);

const BACK_KEY = 'common.back';

describe('Layout sider brand Home button', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    navigate.mockClear();
    openDevTools.mockClear();
    platformMocks.isElectronDesktopMock.mockReturnValue(false);
    shortcutMocks.params = undefined;
    featureMocks.teamModeEnabled = false;
    featureMocks.discontinuedBuild = false;
    updateMocks.restoreDownloaded.mockResolvedValue({ success: true, data: { ready: false } });
    updateMocks.consumeInstallerFailure.mockResolvedValue({ success: true, data: null });
    vi.stubGlobal('__APP_VERSION__', '0.1.0');
    sessionStorage.clear();
    currentPathname = '/guid';
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('navigates to the recorded last non-settings path when clicked in a settings route', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/abc');
    renderLayout();

    fireEvent.click(screen.getByLabelText(BACK_KEY));
    expect(navigate).toHaveBeenCalledWith('/conversation/abc');
  });

  it('falls back to /guid in a settings route when no path is recorded', () => {
    currentPathname = '/settings/system';
    renderLayout();

    fireEvent.click(screen.getByLabelText(BACK_KEY));
    expect(navigate).toHaveBeenCalledWith('/guid');
  });

  it('falls back to /guid when the recorded path is itself a settings path', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/settings/system');
    renderLayout();

    fireEvent.click(screen.getByLabelText(BACK_KEY));
    expect(navigate).toHaveBeenCalledWith('/guid');
  });

  it('activates via keyboard (Enter and Space) in a settings route', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/abc');
    renderLayout();

    const brand = screen.getByLabelText(BACK_KEY);
    fireEvent.keyDown(brand, { key: 'Enter' });
    fireEvent.keyDown(brand, { key: ' ' });
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledWith('/conversation/abc');
  });

  it('ignores non-activation keys in a settings route', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/abc');
    renderLayout();

    const brand = screen.getByLabelText(BACK_KEY);
    fireEvent.keyDown(brand, { key: 'Tab' });
    fireEvent.keyDown(brand, { key: 'a' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders the wordmark as a non-actionable element in a non-settings route', () => {
    currentPathname = '/guid';
    renderLayout();

    // No actionable role/label in chat routes.
    expect(screen.queryByLabelText(BACK_KEY)).toBeNull();
    const wordmark = screen.getByText(APP_DISPLAY_NAME);
    fireEvent.click(wordmark);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('renders the PM monogram inside the existing sidebar icon footprint', () => {
    const { container } = renderLayout();

    const monogram = container.querySelector('.brand-monogram');
    expect(monogram).toHaveTextContent(APP_MONOGRAM);
    expect(monogram?.parentElement).toHaveClass('size-32px', 'bg-black');
  });

  it('does not navigate when the wordmark is clicked in a non-settings route', () => {
    currentPathname = '/conversation/xyz';
    renderLayout();

    fireEvent.click(screen.getByText(APP_DISPLAY_NAME));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('provides common shortcuts with a functional sider toggle', () => {
    currentPathname = '/conversation/xyz';
    const { container } = renderLayout();
    const sider = container.querySelector('.layout-sider');

    expect(shortcutMocks.params?.toggleSider).toEqual(expect.any(Function));
    expect(sider).not.toHaveClass('collapsed');

    act(() => shortcutMocks.params?.toggleSider());
    expect(sider).toHaveClass('collapsed');

    act(() => shortcutMocks.params?.toggleSider());
    expect(sider).not.toHaveClass('collapsed');
  });

  it('keeps the common shortcut owner mounted on team routes', () => {
    currentPathname = '/team/team-1';
    featureMocks.teamModeEnabled = true;

    renderLayout();

    expect(shortcutMocks.params?.toggleSider).toEqual(expect.any(Function));
  });

  it('clicking the logo icon counts toward the devtools easter-egg and never navigates', () => {
    currentPathname = '/settings/about';
    sessionStorage.setItem('aion:last-non-settings-path', '/conversation/abc');
    const { container } = renderLayout();

    // The icon is the SVG-wrapping div (bg-black), separate from the wordmark.
    const icon = container.querySelector('.bg-black') as HTMLElement;
    expect(icon).toBeTruthy();
    for (let i = 0; i < 4; i++) fireEvent.click(icon);
    expect(openDevTools).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('adversarial: ignores legacy tray update events in the independent project', () => {
    platformMocks.isElectronDesktopMock.mockReturnValue(true);
    const openListener = vi.fn();
    window.addEventListener('aionui-open-update-modal', openListener);

    try {
      renderLayout();

      window.dispatchEvent(new Event('tray:check-update'));

      expect(navigate).not.toHaveBeenCalled();
      expect(openListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('aionui-open-update-modal', openListener);
    }
  });

  it('normal: starts without restoring downloaded upstream updates', async () => {
    await import('@/renderer/components/settings/UpdateModal');
    await act(async () => {
      renderLayout();
    });
    expect(updateMocks.restoreDownloaded).not.toHaveBeenCalled();
    expect(updateMocks.consumeInstallerFailure).not.toHaveBeenCalled();
  });

  it('adversarial: keeps upstream migration dialogs unmounted when an obsolete build flag is set', async () => {
    featureMocks.discontinuedBuild = true;
    localStorage.removeItem('aionui.migration-invite-shown');
    await act(async () => {
      renderLayout();
    });
    expect(screen.queryByText('update.migration.letter.title')).not.toBeInTheDocument();
    expect(localStorage.getItem('aionui.migration-invite-shown')).toBeNull();
    expect(updateMocks.restoreDownloaded).not.toHaveBeenCalled();
  });
});
