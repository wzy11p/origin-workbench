import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Button, Message, Modal, Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { I18nKey } from '@renderer/services/i18n';
import type { StudioItem } from '@/common/types/studio';
import styles from './studio.module.css';

export const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');
export function useText() {
  const { t } = useTranslation();
  return (key: string, values?: Record<string, unknown>): string => t(`studio.${key}` as I18nKey, values) as string;
}
export function useAction(exclusive = false) {
  const t = useText();
  const [busy, setBusy] = useState(false);
  const running = useRef(0);
  const run = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    if (exclusive && running.current > 0) return undefined;
    running.current++;
    setBusy(true);
    try {
      const result = await fn();
      if (success) Message.success(success);
      return result;
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const key = `errors.${code}`;
      const message = t(key);
      Message.error(message.startsWith('studio.') ? t('errorGeneric') : message);
      return undefined;
    } finally {
      running.current--;
      setBusy(running.current > 0);
    }
  };
  return { busy, run };
}
export function Status({ item }: { item: Pick<StudioItem, 'status'> }) {
  const t = useText();
  return (
    <Tag
      className={styles.status}
      color={['confirmed', 'decided', 'ready', 'current'].includes(item.status) ? 'green' : undefined}
    >
      {t(`status.${item.status}`)}
    </Tag>
  );
}
export function Empty({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyMark} aria-hidden>
        ◦
      </span>
      <p>{message}</p>
      {action}
    </div>
  );
}
export function ConfirmButton({
  title,
  hint,
  onConfirm,
  children,
  disabled,
}: {
  title: string;
  hint: string;
  onConfirm: () => Promise<unknown>;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const t = useText();
  const [visible, setVisible] = useState(false);
  const { busy, run } = useAction();
  return (
    <>
      <Button type='primary' disabled={disabled} onClick={() => setVisible(true)}>
        {children}
      </Button>
      <Modal
        visible={visible}
        title={title}
        onCancel={() => setVisible(false)}
        confirmLoading={busy}
        okText={t('confirm')}
        cancelText={t('cancel')}
        onOk={async () => {
          const ok = await run(async () => {
            await onConfirm();
            return true;
          });
          if (ok) setVisible(false);
        }}
      >
        {hint}
      </Modal>
    </>
  );
}
const dirtyScopes = new WeakMap<(dirty: boolean) => void, Map<symbol, boolean>>();
export function useUnsaved(dirty: boolean): void {
  const { setDirty } = useContext(DraftContext);
  const owner = useRef(Symbol('draft'));
  useEffect(() => {
    let scopes = dirtyScopes.get(setDirty);
    if (!scopes) {
      scopes = new Map();
      dirtyScopes.set(setDirty, scopes);
    }
    scopes.set(owner.current, dirty);
    setDirty([...scopes.values()].some(Boolean));
    return () => {
      scopes.delete(owner.current);
      setDirty([...scopes.values()].some(Boolean));
    };
  }, [dirty, setDirty]);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent): void => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [dirty]);
}
export const DraftContext = createContext<{ setDirty: (dirty: boolean) => void; guard: (action: () => void) => void }>({
  setDirty: () => undefined,
  guard: (action) => action(),
});
export const useGuard = () => useContext(DraftContext).guard;
export function StudioReturn() {
  const t = useText();
  const navigate = useNavigate();
  return (
    <Button className={styles.returnLink} onClick={() => void navigate('/studio')}>
      {t('back')}
    </Button>
  );
}
