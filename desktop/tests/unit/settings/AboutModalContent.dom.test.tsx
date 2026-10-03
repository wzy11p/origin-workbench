// Modified for Origin Workbench, 2026.
/**
 * @license
 * Copyright 2026 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Origin Workbench: project-owned entry points and disabled upstream updates.
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  quitAndInstall: vi.fn(),
  openExternalUrl: vi.fn(),
  runUpdateCheck: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/common', () => ({
  ipcBridge: {
    autoUpdate: { quitAndInstall: { invoke: mocks.quitAndInstall } },
  },
}));
vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
  openExternalUrl: mocks.openExternalUrl,
}));
vi.mock('@/renderer/components/settings/checkForUpdatesShared', () => ({
  getIncludePrerelease: () => false,
  runUpdateCheck: mocks.runUpdateCheck,
}));
vi.mock('@/renderer/components/settings/SettingsModal/settingsViewContext', () => ({
  useSettingsViewMode: () => 'modal',
}));

import AboutModalContent from '@/renderer/components/settings/SettingsModal/contents/AboutModalContent';
import { setUpdateReadyState } from '@/renderer/components/settings/updateReadyState';

beforeEach(() => {
  vi.stubGlobal('__APP_VERSION__', '0.1.0');
  mocks.openExternalUrl.mockResolvedValue(undefined);
});

afterEach(() => {
  setUpdateReadyState({ ready: false, version: '' });
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AboutModalContent normal project links', () => {
  it.each([
    ['settings.helpDocumentation', 'https://github.com/wzy11p/origin-workbench#readme'],
    ['settings.updateLog', 'https://github.com/wzy11p/origin-workbench/releases'],
    ['settings.bugReport', 'https://github.com/wzy11p/origin-workbench/issues/new'],
    ['settings.contactMe', 'https://github.com/wzy11p'],
    ['settings.officialWebsite', 'https://github.com/wzy11p/origin-workbench'],
  ])('opens %s in the appropriate project location', async (label, url) => {
    render(<AboutModalContent />);
    fireEvent.click(screen.getByText(label));
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalledWith(url));
  });
});

describe('AboutModalContent adversarial project links', () => {
  it('cannot install an upstream release even when a downloaded update event arrives', async () => {
    render(<AboutModalContent />);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('aionui-update-ready-state-changed', {
          detail: { ready: true, version: '99.0.0', filePath: '/tmp/upstream.dmg' },
        })
      );
    });
    expect(screen.queryByText('settings.updateReadyInstall')).not.toBeInTheDocument();
    expect(mocks.quitAndInstall).not.toHaveBeenCalled();
    expect(mocks.runUpdateCheck).not.toHaveBeenCalled();
  });

  it('keeps the about panel usable when an external link cannot open', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.openExternalUrl.mockRejectedValueOnce(new Error('shell unavailable'));
    render(<AboutModalContent />);
    fireEvent.click(screen.getByText('settings.helpDocumentation'));
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalledOnce());
    expect(screen.getByText('原点工作台')).toBeInTheDocument();
    expect(screen.getByText('settings.helpDocumentation')).toBeInTheDocument();
  });
});
