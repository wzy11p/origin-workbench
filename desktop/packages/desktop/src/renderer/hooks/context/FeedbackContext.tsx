// Modified for Origin Workbench, 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Origin Workbench: open a public issue handoff without collecting local context.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import FeedbackReportModal, {
  type FeedbackEventExtra,
  type FeedbackEventTags,
} from '@/renderer/components/settings/SettingsModal/contents/FeedbackReportModal';
import type {
  FeedbackDiagnosticsExplicitContext,
  FeedbackDiagnosticsProfile,
} from '@/common/types/feedbackDiagnostics';

// Preserve the caller contract while ignoring private diagnostics from older buttons.
type OpenFeedbackOptions = {
  module?: string;
  autoScreenshot?: boolean;
  diagnosticsContext?: FeedbackDiagnosticsExplicitContext;
  diagnosticsProfiles?: FeedbackDiagnosticsProfile[];
  tags?: FeedbackEventTags;
  extra?: FeedbackEventExtra;
};

type FeedbackContextValue = {
  openFeedback: (options?: OpenFeedbackOptions) => Promise<void>;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export const FeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [visible, setVisible] = useState(false);
  const openFeedback = useCallback(async (_options?: OpenFeedbackOptions) => {
    setVisible(true);
  }, []);
  const value = useMemo(() => ({ openFeedback }), [openFeedback]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <FeedbackReportModal visible={visible} onCancel={() => setVisible(false)} />
    </FeedbackContext.Provider>
  );
};

export const useFeedback = (): FeedbackContextValue => {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    return {
      openFeedback: async () => {
        /* A button outside the provider must not trigger external actions. */
      },
    };
  }
  return ctx;
};
