import React, { useState } from 'react';
import { Button, Collapse, Drawer, Input, Modal, Select, Tabs } from '@arco-design/web-react';
import type { StudioItem, StudioProject } from '@/common/types/studio';
import { api, exportProject } from './client';
import { useAction, useGuard, useText, useUnsaved } from './common';
import { StructuredSource } from './panels/SourceReader';
import Assets from './panels/Assets';
import Methods from './panels/Methods';
import Canvas from './panels/Canvas';
import Review from './panels/Review';
import Backups from './panels/Backups';
import Planning from './panels/Planning';
import styles from './studio.module.css';

export default function Project({
  project,
  items,
  preferences,
  refresh,
  home,
}: {
  project: StudioProject;
  items: StudioItem[];
  preferences: StudioItem[];
  refresh: () => Promise<void>;
  home: () => void;
}) {
  const t = useText();
  const guard = useGuard();
  const { busy, run } = useAction();
  const [tab, setTab] = useState('overview');
  const [focus, setFocus] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [intent, setIntent] = useState(project.intent);
  const [deleting, setDeleting] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [sourceSnapshot, setSourceSnapshot] = useState<StudioItem | null>(null);
  useUnsaved(editing && (title !== project.title || intent !== project.intent));
  const changeTab = (value: string): void =>
    guard(() => {
      setTab(value);
      setFocus('');
    });
  const openSource = (id: string, sourceVersion?: number): void => {
    const item = [...items, ...preferences].find((i) => i.id === id);
    if (!item) return;
    guard(() => {
      if (sourceVersion || item.kind === 'preference') {
        void run(async () => {
          const versions = await api<{ version: number; snapshot: StudioItem }[]>(`/items/${id}/versions`);
          const snapshot = versions.find((v) => v.version === (sourceVersion ?? item.version))?.snapshot;
          if (!snapshot) throw new Error('NOT_FOUND');
          setSourceSnapshot(snapshot);
        });
        return;
      }
      setTab(
        ['material', 'citation'].includes(item.kind)
          ? 'materials'
          : item.kind === 'decision'
            ? 'decisions'
            : item.kind === 'artifact'
              ? 'documents'
              : item.kind === 'canvas'
                ? 'canvas'
                : item.kind === 'workflow'
                  ? 'methods'
                  : 'overview'
      );
      setFocus(id);
    });
  };
  const stages = ['灵感', '发现', '定义', '设计', '验证', '交付', '暂停'];
  const stageKeys = [
    'stageIdea',
    'stageDiscovery',
    'stageDefine',
    'stageDesign',
    'stageValidate',
    'stageShip',
    'stagePause',
  ];
  const props = { projectId: project.id, items, allItems: items, refresh, focusId: focus, openSource };
  return (
    <div className={styles.project}>
      <header className={styles.projectHeader}>
        <div>
          <span className={styles.eyebrow}>{t('myProjects')}</span>
          <h1>{project.title}</h1>
          <p>{project.intent}</p>
        </div>
        <div className={styles.actions}>
          <Select
            aria-label={t('stage')}
            value={project.stage}
            options={stages.map((value, i) => ({ value, label: t(stageKeys[i]) }))}
            style={{ width: 100 }}
            onChange={(stage) =>
              void run(async () => {
                await api(`/projects/${project.id}`, 'PATCH', { stage });
                await refresh();
              })
            }
          />
          <Backups project={project} refresh={refresh} />
          <Button onClick={() => void run(() => exportProject(project))}>{t('exportProject')}</Button>
          <Button
            type='text'
            onClick={() => {
              setTitle(project.title);
              setIntent(project.intent);
              setEditing(true);
            }}
          >
            {t('edit')}
          </Button>
        </div>
      </header>
      <Tabs activeTab={tab} onChange={changeTab} className={styles.projectTabs}>
        {['overview', 'materials', 'methods', 'decisions', 'canvas', 'documents', 'review'].map((key) => (
          <Tabs.TabPane key={key} title={t(key)} />
        ))}
      </Tabs>
      <div className={styles.projectBody}>
        {tab === 'overview' && (
          <>
            <Planning project={project} items={items} refresh={refresh} openSource={openSource} focusId={focus} />
            <Collapse
              bordered={false}
              activeKey={
                items.some((i) => i.id === focus && ['insight', 'assumption', 'capture'].includes(i.kind))
                  ? ['notes']
                  : undefined
              }
            >
              <Collapse.Item name='notes' header={t('projectNotes')}>
                <Assets {...props} kinds={['insight', 'assumption', 'capture']} />
              </Collapse.Item>
            </Collapse>
          </>
        )}
        {tab === 'materials' && <Assets {...props} kinds={['material', 'citation']} />}
        {tab === 'methods' && <Methods projectId={project.id} items={items} refresh={refresh} focusId={focus} />}
        {tab === 'decisions' && <Assets {...props} kinds={['decision']} />}
        {tab === 'canvas' && <Canvas projectId={project.id} items={items} refresh={refresh} focusId={focus} />}
        {tab === 'documents' && <Assets {...props} kinds={['artifact']} />}
        {tab === 'review' && <Review project={project} items={items} preferences={preferences} refresh={refresh} />}
      </div>
      <Drawer
        visible={sourceSnapshot !== null}
        width={720}
        title={sourceSnapshot ? `${sourceSnapshot.title} · v${sourceSnapshot.version}` : ''}
        footer={null}
        onCancel={() => setSourceSnapshot(null)}
      >
        {sourceSnapshot && (
          <>
            <p>{t('historicalSourceHint')}</p>
            <StructuredSource item={sourceSnapshot} />
            <Collapse bordered={false}>
              <Collapse.Item name='snapshot' header={t('sourceSnapshot')}>
                <pre className={styles.sourceContent}>{JSON.stringify(sourceSnapshot.body, null, 2)}</pre>
              </Collapse.Item>
            </Collapse>
            {sourceSnapshot.kind !== 'preference' && (
              <Button
                onClick={() => {
                  const id = sourceSnapshot.id;
                  setSourceSnapshot(null);
                  openSource(id);
                }}
              >
                {t('openCurrentSource')}
              </Button>
            )}
          </>
        )}
      </Drawer>
      <Modal
        visible={editing}
        title={t('edit')}
        onCancel={() => guard(() => setEditing(false))}
        confirmLoading={busy}
        okText={t('save')}
        cancelText={t('cancel')}
        onOk={async () => {
          await run(async () => {
            await api(`/projects/${project.id}`, 'PATCH', { title, intent });
            await refresh();
            setEditing(false);
          });
        }}
      >
        <label className={styles.field}>
          {t('title')}
          <Input disabled={busy} value={title} onChange={setTitle} aria-label={t('title')} maxLength={160} />
        </label>
        <label className={styles.field}>
          {t('intent')}
          <Input.TextArea
            value={intent}
            disabled={busy}
            onChange={setIntent}
            aria-label={t('intent')}
            autoSize={{ minRows: 3 }}
            maxLength={20000}
          />
        </label>
        <div className={styles.editorFoot}>
          <Button
            onClick={() =>
              void run(async () => {
                await api(`/projects/${project.id}`, 'PATCH', { archived: !project.archived });
                await refresh();
                setEditing(false);
                home();
              })
            }
          >
            {t(project.archived ? 'unarchive' : 'archive')}
          </Button>
          <Button
            type='text'
            status='danger'
            onClick={() => {
              setEditing(false);
              setDeleting(true);
            }}
          >
            {t('deleteProject')}
          </Button>
        </div>
      </Modal>
      <Modal
        visible={deleting}
        title={t('deleteProject')}
        onCancel={() => setDeleting(false)}
        okText={t('delete')}
        cancelText={t('cancel')}
        okButtonProps={{ status: 'danger', disabled: confirmation !== project.title }}
        onOk={async () => {
          await run(async () => {
            await api(`/projects/${project.id}`, 'DELETE', { confirmation });
            await refresh();
            home();
          });
        }}
      >
        <p>{t('deleteHint')}</p>
        <Input value={confirmation} onChange={setConfirmation} aria-label={t('title')} />
      </Modal>
    </div>
  );
}
