import React, { useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Upload } from '@arco-design/web-react';
import { ArrowRight, Plus, Inbox } from '@icon-park/react';
import type { StudioProject } from '@/common/types/studio';
import { api, createItem } from './client';
import { Empty, useAction, useGuard, useText, useUnsaved } from './common';
import styles from './studio.module.css';

export default function Home({
  projects,
  refresh,
  open,
}: {
  projects: StudioProject[];
  refresh: () => Promise<void>;
  open: (id: string) => void;
}) {
  const t = useText();
  const guard = useGuard();
  const { busy, run } = useAction(true);
  const draftKey = 'origin:capture-draft:v1';
  const [idea, setIdea] = useState(() => {
    try {
      return window.localStorage.getItem(draftKey) ?? '';
    } catch {
      return '';
    }
  });
  const latestIdea = useRef(idea);
  const [draftFailed, setDraftFailed] = useState(false);
  useUnsaved(draftFailed && Boolean(idea));
  const changeIdea = (value: string): void => {
    latestIdea.current = value;
    setIdea(value);
    try {
      window.localStorage.setItem(draftKey, value);
      setDraftFailed(false);
    } catch {
      setDraftFailed(true);
    }
  };
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState('');
  const [intent, setIntent] = useState('');
  useUnsaved(show && Boolean(title || intent));
  const [archived, setArchived] = useState(false);
  const capture = (): void => {
    if (!idea.trim()) return;
    const submitted = idea;
    void run(async () => {
      await createItem(null, 'capture', submitted.trim().slice(0, 50), { content: submitted });
      if (latestIdea.current === submitted) changeIdea('');
      await refresh();
    }, t('captureSaved'));
  };
  const visible = projects.filter((p) => archived || !p.archived);
  return (
    <div className={styles.home}>
      <div className={styles.eyebrow}>{t('brand')}</div>
      <h1>{t('welcome')}</h1>
      <p className={styles.intro}>{t('intro')}</p>
      <section className={styles.captureBox}>
        <Input.TextArea
          value={idea}
          onChange={changeIdea}
          placeholder={t('capturePlaceholder')}
          aria-label={t('capture')}
          maxLength={20000}
          autoSize={{ minRows: 3, maxRows: 6 }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              capture();
            }
          }}
        />
        {draftFailed ? (
          <Alert type='warning' content={t('draftStorageFailed')} />
        ) : (
          idea && <p className={styles.hint}>{t('ideaDraftSaved')}</p>
        )}
        <div className={styles.captureFoot}>
          <span>
            <Inbox size={14} />
            {t('keptOriginal')}
          </span>
          <Button type='primary' disabled={!idea.trim()} loading={busy} onClick={capture}>
            {t('capture')}
            <ArrowRight size={15} />
          </Button>
        </div>
      </section>
      <div className={styles.sectionHead}>
        <h2>{t('myProjects')}</h2>
        <div className={styles.actions}>
          <Upload
            accept='.json'
            showUploadList={false}
            beforeUpload={(file) => {
              void run(async () => {
                const p = await api<StudioProject>('/import', 'POST', JSON.parse(await file.text()));
                await refresh();
                open(p.id);
              });
              return false;
            }}
          >
            <Button type='text'>{t('importProject')}</Button>
          </Upload>
          <Button type='outline' icon={<Plus size={15} />} onClick={() => setShow(true)}>
            {t('newProject')}
          </Button>
        </div>
      </div>
      {visible.length ? (
        <div className={styles.projectList}>
          {visible.map((p) => (
            <Button key={p.id} className={styles.projectRow} type='text' onClick={() => open(p.id)}>
              <div className={styles.projectMark}>{p.title.slice(0, 1)}</div>
              <div className={styles.projectText}>
                <strong>{p.title}</strong>
                <span>{p.intent || t('overviewHint')}</span>
              </div>
              <span className={styles.projectStage}>{p.archived ? t('status.archived') : p.stage}</span>
              <ArrowRight size={18} />
            </Button>
          ))}
        </div>
      ) : (
        <Empty message={t('emptyProjects')} />
      )}
      <Checkbox className={styles.archivedCheck} checked={archived} onChange={setArchived}>
        {t('showArchived')}
      </Checkbox>
      <Modal
        visible={show}
        title={t('newProject')}
        onCancel={() => guard(() => setShow(false))}
        okText={t('create')}
        cancelText={t('cancel')}
        confirmLoading={busy}
        okButtonProps={{ disabled: !title.trim() }}
        onOk={async () => {
          if (!title.trim()) return;
          await run(async () => {
            const p = await api<StudioProject>('/projects', 'POST', { title, intent });
            setShow(false);
            setTitle('');
            setIntent('');
            await refresh();
            open(p.id);
          });
        }}
      >
        <label className={styles.field}>
          {t('title')}
          <Input autoFocus disabled={busy} value={title} onChange={setTitle} maxLength={160} aria-label={t('title')} />
        </label>
        <label className={styles.field}>
          {t('intent')}
          <Input.TextArea
            value={intent}
            disabled={busy}
            onChange={setIntent}
            maxLength={20000}
            aria-label={t('intent')}
            autoSize={{ minRows: 3 }}
          />
        </label>
      </Modal>
    </div>
  );
}
