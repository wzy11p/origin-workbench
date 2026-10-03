// Modified for Origin Workbench, 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Origin Workbench: public issue handoff without diagnostic uploads.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from '@arco-design/web-react';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  captureEvent: vi.fn(),
  collectFeedbackLogs: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', fontScale: 1 }),
}));
vi.mock('@/renderer/hooks/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'private-user', username: 'private', email: 'private@example.test' } }),
}));
vi.mock('@/renderer/utils/platform', () => ({
  openExternalUrl: mocks.openExternalUrl,
  isElectronDesktop: () => true,
}));
vi.mock('@sentry/electron/renderer', () => ({
  captureEvent: mocks.captureEvent,
  withScope: vi.fn(),
}));

import FeedbackReportModal from '@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal';

const issueUrl = 'https://github.com/wzy11p/origin-workbench/issues/new';
const renderModal = (ui: React.ReactElement) => render(<ConfigProvider>{ui}</ConfigProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openExternalUrl.mockResolvedValue(undefined);
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    collectFeedbackLogs: mocks.collectFeedbackLogs,
  };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('FeedbackReportModal normal issue handoff', () => {
  it('opens this project issue page only after the user chooses to continue', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderModal(<FeedbackReportModal visible onCancel={onCancel} />);
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'settings.bugReportSubmit' }));
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalledWith(issueUrl));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('allows cancelling without opening or submitting a report', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderModal(<FeedbackReportModal visible onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'settings.bugReportCancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
    expect(mocks.captureEvent).not.toHaveBeenCalled();
  });
});

describe('FeedbackReportModal adversarial issue handoff', () => {
  it('keeps the report dialog and copyable URL visible when opening GitHub fails', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    mocks.openExternalUrl.mockRejectedValueOnce(new Error('shell unavailable'));
    renderModal(<FeedbackReportModal visible onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'settings.bugReportSubmit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('settings.bugReportError');
    expect(screen.getByText(issueUrl)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('does not collect or send private context supplied by older feedback buttons', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderModal(
      <FeedbackReportModal
        visible
        onCancel={vi.fn()}
        defaultModule='system-settings'
        prefilledScreenshots={[{ filename: 'private.png', data: new Uint8Array([1, 2]), type: 'image/png' }]}
        feedbackTags={{ private: 'sensitive' }}
        feedbackExtra={{ apiKey: 'not-a-real-key' }}
        feedbackDiagnosticsContext={{ explicitContext: { conversationId: 'private-conversation' } }}
      />
    );
    await user.click(screen.getByRole('button', { name: 'settings.bugReportSubmit' }));
    await waitFor(() => expect(mocks.openExternalUrl).toHaveBeenCalledWith(issueUrl));
    expect(mocks.captureEvent).not.toHaveBeenCalled();
    expect(mocks.collectFeedbackLogs.mock.calls.length + fetchMock.mock.calls.length).toBe(0);
  });

  it('prevents duplicate launches while the external browser is opening', async () => {
    const user = userEvent.setup();
    let resolveOpen!: () => void;
    mocks.openExternalUrl.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveOpen = resolve;
        })
    );
    renderModal(<FeedbackReportModal visible onCancel={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'settings.bugReportSubmit' });
    await user.dblClick(button);
    expect(button).toBeDisabled();
    expect(mocks.openExternalUrl).toHaveBeenCalledOnce();
    resolveOpen();
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
