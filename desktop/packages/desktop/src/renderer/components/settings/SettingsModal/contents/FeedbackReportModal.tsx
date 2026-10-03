// Modified for Origin Workbench, 2026.
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 * Modified for Origin Workbench: public issue handoff without diagnostic uploads.
 */

import AionModal from '@renderer/components/base/AionModal';
import { Alert, Button, Typography } from '@arco-design/web-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_REPOSITORY_URL } from '@/common/branding';
import { openExternalUrl } from '@/renderer/utils/platform';
import type {
  FeedbackDiagnosticsExplicitContext,
  FeedbackDiagnosticsProfile,
} from '@/common/types/feedbackDiagnostics';
import type { FeedbackEventExtra, FeedbackEventTags } from '@/renderer/services/feedback/submitFeedbackReport';

export type { FeedbackEventExtra, FeedbackEventTags } from '@/renderer/services/feedback/submitFeedbackReport';

export type PrefilledScreenshot = {
  filename: string;
  data: Uint8Array;
  type: string;
};

// Existing feedback buttons may still pass context. It is deliberately ignored:
// public GitHub feedback must never include local content without the user's review.
type FeedbackReportModalProps = {
  visible: boolean;
  onCancel: () => void;
  defaultModule?: string;
  prefilledScreenshots?: PrefilledScreenshot[];
  feedbackTags?: FeedbackEventTags;
  feedbackExtra?: FeedbackEventExtra;
  feedbackDiagnosticsContext?: {
    explicitContext?: FeedbackDiagnosticsExplicitContext;
    explicitProfiles?: FeedbackDiagnosticsProfile[];
    routeAtOpen?: string;
  };
};

const ISSUE_URL = `${APP_REPOSITORY_URL}/issues/new`;

const FeedbackReportModal: React.FC<FeedbackReportModalProps> = ({ visible, onCancel }) => {
  const { t } = useTranslation();
  const [opening, setOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  const openingRef = useRef(false);

  useEffect(() => {
    if (visible) setFailed(false);
  }, [visible]);

  const handleOpen = async (): Promise<void> => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setFailed(false);
    try {
      await openExternalUrl(ISSUE_URL);
      onCancel();
    } catch {
      setFailed(true);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };

  return (
    <AionModal
      variant='standard'
      header={{ title: t('settings.bugReportTitle'), showClose: true }}
      visible={visible}
      onCancel={onCancel}
      onOk={handleOpen}
      confirmLoading={opening}
      okText={t('settings.bugReportSubmit')}
      cancelText={t('settings.bugReportCancel')}
      footer={{
        render: () => (
          <div className='flex justify-end gap-8px'>
            <Button onClick={onCancel}>{t('settings.bugReportCancel')}</Button>
            <Button type='primary' loading={opening} disabled={opening} onClick={() => void handleOpen()}>
              {t('settings.bugReportSubmit')}
            </Button>
          </div>
        ),
      }}
      alignCenter
      className='w-[min(600px,calc(100vw-32px))] max-w-600px'
      wrapStyle={{ zIndex: 1050 }}
      maskStyle={{ zIndex: 1050 }}
    >
      <div data-testid='feedback-report-scroll-body'>
        <Typography.Paragraph>{t('settings.bugReportAutoInfo')}</Typography.Paragraph>
        <Typography.Paragraph copyable className='break-all'>
          {ISSUE_URL}
        </Typography.Paragraph>
        {failed && <Alert type='error' content={t('settings.bugReportError')} />}
      </div>
    </AionModal>
  );
};

export default FeedbackReportModal;
