import React, { useState } from 'react';
import { Alert, Button, Drawer } from '@arco-design/web-react';
import type { StudioProject } from '@/common/types/studio';
import { api } from '../client';
import { Empty, useAction, useText } from '../common';
import styles from '../studio.module.css';
type BackupList = { entries: { name: string; updatedAt: number; size: number }[]; failed: boolean };
export default function Backups({ project, refresh }: { project: StudioProject; refresh: () => Promise<void> }) {
  const t = useText();
  const { busy, run } = useAction();
  const [data, setData] = useState<BackupList | null>(null);
  const load = async (): Promise<void> => setData(await api<BackupList>(`/projects/${project.id}/backups`));
  return (
    <>
      <Button onClick={() => void run(load)}>{t('backups')}</Button>
      <Drawer title={t('backups')} visible={data !== null} onCancel={() => setData(null)} width={480} footer={null}>
        <p>{t('backupHint')}</p>
        {data?.failed && <Alert type='error' content={t('errors.BACKUP_FAILED')} />}
        <Button
          type='primary'
          loading={busy}
          onClick={() =>
            void run(async () => {
              await api(`/projects/${project.id}/backups`, 'POST', {});
              await load();
            }, t('saved'))
          }
        >
          {t('backupNow')}
        </Button>
        {!data?.entries.length && <Empty message={t('noItems')} />}
        {data?.entries.map((entry) => (
          <section key={entry.name} className={styles.version}>
            <h3>{entry.name.slice(0, 10)}</h3>
            <p>
              {new Date(entry.updatedAt).toLocaleString()} · {(entry.size / 1024 / 1024).toFixed(1)} MB
            </p>
            <Button
              loading={busy}
              onClick={() =>
                void run(async () => {
                  await api(`/projects/${project.id}/backups`, 'POST', { restore: entry.name });
                  await refresh();
                }, t('backupRestored'))
              }
            >
              {t('restoreAsCopy')}
            </Button>
          </section>
        ))}
      </Drawer>
    </>
  );
}
