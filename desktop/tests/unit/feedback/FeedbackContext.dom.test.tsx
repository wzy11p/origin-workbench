// Modified for Origin Workbench, 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Origin Workbench: no automatic screenshot or diagnostic collection.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({ captureScreenshot: vi.fn(), openExternalUrl: vi.fn() }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('@/renderer/hooks/context/ThemeContext', () => ({
  useThemeContext: () => ({ theme: 'light', fontScale: 1 }),
}));
vi.mock('@/renderer/utils/platform', () => ({ openExternalUrl: mocks.openExternalUrl }));

import { FeedbackProvider, useFeedback } from '@/renderer/hooks/context/FeedbackContext';

function Trigger() {
  const { openFeedback } = useFeedback();
  return (
    <button
      type='button'
      onClick={() =>
        void openFeedback({
          module: 'system-settings',
          autoScreenshot: true,
          diagnosticsContext: { conversationId: 'private-conversation' },
          extra: { secret: 'private-content' },
        })
      }
    >
      open
    </button>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.captureScreenshot.mockResolvedValue({ filename: 'private.png', data: [1, 2, 3] });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    captureFeedbackScreenshot: mocks.captureScreenshot,
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
});

describe('FeedbackProvider normal issue handoff', () => {
  it('shows and closes one feedback handoff dialog', async () => {
    const user = userEvent.setup();
    render(
      <FeedbackProvider>
        <Trigger />
      </FeedbackProvider>
    );
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'settings.bugReportCancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('remains safe when a button is rendered outside the provider', async () => {
    const user = userEvent.setup();
    render(<Trigger />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.captureScreenshot).not.toHaveBeenCalled();
  });
});

describe('FeedbackProvider adversarial issue handoff', () => {
  it('ignores automatic screenshot requests and keeps private context out of the issue handoff', async () => {
    const user = userEvent.setup();
    render(
      <FeedbackProvider>
        <Trigger />
      </FeedbackProvider>
    );
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(mocks.captureScreenshot).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'settings.bugReportSubmit' }));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://github.com/wzy11p/origin-workbench/issues/new');
    expect(screen.queryByText('private-content')).not.toBeInTheDocument();
  });
});
