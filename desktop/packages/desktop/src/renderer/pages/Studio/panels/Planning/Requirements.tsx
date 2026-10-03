import React, { useEffect, useState } from 'react';
import { Button, Input, Select } from '@arco-design/web-react';
import { Plus } from '@icon-park/react';
import type { StudioItem, StudioProject } from '@/common/types/studio';
import { createItem, saveItem } from '../../client';
import { textOf, useAction, useGuard, useText, useUnsaved } from '../../common';
import styles from './planning.module.css';

export default function Requirements({
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
  const requirements = items
    .filter((i) => i.kind === 'requirement' && i.status !== 'archived')
    .toSorted((a, b) => String(a.body.requirementId).localeCompare(String(b.body.requirementId)));
  const current = requirements.find((i) => i.id === selected);
  return (
    <div>
      <div className={styles.heading}>
        <p>{t('requirementsHint')}</p>
        <Button icon={<Plus size={15} />} onClick={() => guard(() => setSelected(''))}>
          {t('addRequirement')}
        </Button>
      </div>
      <div className={styles.blueprint}>
        <nav className={styles.fieldNav} aria-label={t('requirements')}>
          {requirements.map((item) => (
            <Button
              key={item.id}
              type='text'
              className={selected === item.id ? styles.selected : ''}
              onClick={() => guard(() => setSelected(item.id))}
            >
              {String(item.body.requirementId)} · {item.title}
            </Button>
          ))}
        </nav>
        <RequirementEditor
          key={current?.id ?? 'new'}
          item={current}
          projectId={project.id}
          refresh={refresh}
          onSaved={setSelected}
        />
      </div>
    </div>
  );
}
function RequirementEditor({
  item,
  projectId,
  refresh,
  onSaved,
}: {
  item?: StudioItem;
  projectId: string;
  refresh: () => Promise<void>;
  onSaved: (id: string) => void;
}) {
  const t = useText();
  const { busy, run } = useAction(true);
  const [base, setBase] = useState(item);
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? { content: '', normal: '', adverse: '', priority: 'first' });
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  return (
    <div className={styles.fieldEditor}>
      <h3>{item ? `${String(body.requirementId)} · ${t('edit')}` : t('addRequirement')}</h3>
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
      <label className={styles.field}>
        {t('requirementPriority')}
        <Select
          aria-label={t('requirementPriority')}
          value={String(body.priority)}
          disabled={busy}
          options={['first', 'later'].map((value) => ({ value, label: t(`priority.${value}`) }))}
          onChange={(priority) => {
            setBody({ ...body, priority });
            setDirty(true);
          }}
        />
      </label>
      {['content', 'normal', 'adverse'].map((key) => (
        <label className={styles.field} key={key}>
          {t(`requirementFields.${key}`)}
          <Input.TextArea
            aria-label={t(`requirementFields.${key}`)}
            value={textOf(body[key])}
            disabled={busy}
            maxLength={100000}
            autoSize={{ minRows: 3, maxRows: 8 }}
            placeholder={t(`requirementHints.${key}`)}
            onChange={(text) => {
              setBody({ ...body, [key]: text });
              setDirty(true);
            }}
          />
        </label>
      ))}
      <div className={styles.actions}>
        <Button
          type='primary'
          loading={busy}
          disabled={!title.trim() || !dirty}
          onClick={() =>
            void run(async () => {
              const saved = base
                ? await saveItem(base, { title, body })
                : await createItem(projectId, 'requirement', title, body);
              setBase(saved);
              setBody(saved.body);
              setDirty(false);
              await refresh();
              onSaved(saved.id);
            }, t('saved'))
          }
        >
          {t('save')}
        </Button>
        {base && (
          <Button
            disabled={busy || dirty}
            onClick={() =>
              void run(async () => {
                await saveItem(base, { status: 'archived' });
                await refresh();
                onSaved('');
              })
            }
          >
            {t('archive')}
          </Button>
        )}
        <span className={styles.hint}>{t(dirty ? 'unsaved' : 'saved')}</span>
      </div>
    </div>
  );
}
