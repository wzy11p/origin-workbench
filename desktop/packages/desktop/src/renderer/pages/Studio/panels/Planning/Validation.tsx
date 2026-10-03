import React, { useEffect, useState } from 'react';
import { Button, Input, Select } from '@arco-design/web-react';
import type { StudioItem, StudioProject } from '@/common/types/studio';
import { createItem, saveItem } from '../../client';
import { textOf, useAction, useGuard, useText, useUnsaved } from '../../common';
import styles from './planning.module.css';

export default function Validation({
  project,
  items,
  refresh,
  focusId,
}: {
  project: StudioProject;
  items: StudioItem[];
  refresh: () => Promise<void>;
  focusId?: string;
}) {
  const t = useText();
  const guard = useGuard();
  const [selected, setSelected] = useState(focusId ?? '');
  useEffect(() => {
    if (focusId) setSelected(focusId);
  }, [focusId]);
  const records = items.filter((i) => i.kind === 'validation' && i.status !== 'archived');
  const current = records.find((i) => i.id === selected);
  return (
    <div>
      <div className={styles.heading}>
        <p>{t('validationHint')}</p>
        <Button onClick={() => guard(() => setSelected(''))}>{t('newValidation')}</Button>
      </div>
      <div className={styles.blueprint}>
        <nav className={styles.fieldNav} aria-label={t('validation')}>
          {records.map((i) => (
            <Button
              key={i.id}
              type='text'
              className={selected === i.id ? styles.selected : ''}
              onClick={() => guard(() => setSelected(i.id))}
            >
              {i.title} · {t(`outcome.${String(i.body.outcome)}`)}
            </Button>
          ))}
        </nav>
        <ValidationEditor
          key={current?.id ?? 'new'}
          item={current}
          items={items}
          projectId={project.id}
          refresh={refresh}
          onSaved={setSelected}
        />
      </div>
    </div>
  );
}
function ValidationEditor({
  item,
  items,
  projectId,
  refresh,
  onSaved,
}: {
  item?: StudioItem;
  items: StudioItem[];
  projectId: string;
  refresh: () => Promise<void>;
  onSaved: (id: string) => void;
}) {
  const t = useText();
  const { busy, run } = useAction(true);
  const [base, setBase] = useState(item);
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(
    item?.body ?? {
      hypothesis: '',
      method: '',
      threshold: '',
      result: '',
      conclusion: '',
      outcome: 'pending',
      sourceIds: [],
    }
  );
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  return (
    <div className={styles.fieldEditor}>
      <h3>{t('validation')}</h3>
      <label className={styles.field}>
        {t('title')}
        <Input
          aria-label={t('title')}
          value={title}
          disabled={busy}
          maxLength={160}
          onChange={(text) => {
            setTitle(text);
            setDirty(true);
          }}
        />
      </label>
      {['hypothesis', 'method', 'threshold', 'result', 'conclusion'].map((key) => (
        <label className={styles.field} key={key}>
          {t(`validationFields.${key}`)}
          <Input.TextArea
            aria-label={t(`validationFields.${key}`)}
            value={textOf(body[key])}
            disabled={busy}
            maxLength={100000}
            autoSize={{ minRows: 2, maxRows: 6 }}
            onChange={(text) => {
              setBody({ ...body, [key]: text });
              setDirty(true);
            }}
          />
        </label>
      ))}
      <label className={styles.field}>
        {t('affectedDecisions')}
        <Select
          mode='multiple'
          aria-label={t('affectedDecisions')}
          disabled={busy}
          value={Array.isArray(body.sourceIds) ? (body.sourceIds as string[]) : []}
          options={items
            .filter((i) => i.kind === 'decision' || i.kind === 'assumption')
            .map((i) => ({ value: i.id, label: i.title }))}
          onChange={(sourceIds) => {
            setBody({ ...body, sourceIds });
            setDirty(true);
          }}
        />
      </label>
      <label className={styles.field}>
        {t('nextDecision')}
        <Select
          aria-label={t('nextDecision')}
          disabled={busy}
          value={String(body.outcome)}
          options={['pending', 'continue', 'adjust', 'park', 'stop'].map((value) => ({
            value,
            label: t(`outcome.${value}`),
          }))}
          onChange={(outcome) => {
            setBody({ ...body, outcome });
            setDirty(true);
          }}
        />
      </label>
      <div className={styles.actions}>
        <Button
          type='primary'
          loading={busy}
          disabled={!title.trim() || !dirty}
          onClick={() =>
            void run(async () => {
              const saved = base
                ? await saveItem(base, { title, body })
                : await createItem(projectId, 'validation', title, body);
              setBase(saved);
              setDirty(false);
              await refresh();
              onSaved(saved.id);
            }, t('saved'))
          }
        >
          {t('save')}
        </Button>
        <span className={styles.hint}>{t(dirty ? 'unsaved' : 'saved')}</span>
      </div>
      <p className={styles.hint}>{t('validationNoAutoDecision')}</p>
    </div>
  );
}
