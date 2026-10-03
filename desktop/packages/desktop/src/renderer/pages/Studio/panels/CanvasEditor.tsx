import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Modal, Select } from '@arco-design/web-react';
import type { PlaitElement, PlaitTheme, Viewport } from '@plait/core';
import type { StudioBody, StudioItem, StudioVersion } from '@/common/types/studio';
import { validateCanvas } from '@/common/studio/canvas';
import { api, createItem, downloadText, saveItem } from '../client';
import { Empty, useAction, useText, useUnsaved } from '../common';
import styles from '../studio.module.css';
const Drawnix = React.lazy(() => import('@drawnix/drawnix').then((module) => ({ default: module.Drawnix })));

class BoardBoundary extends React.Component<{ children: React.ReactNode; message: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  render(): React.ReactNode {
    return this.state.failed ? <Alert type='error' content={this.props.message} /> : this.props.children;
  }
}
/** Stable initial props prevent server polling from feeding a fresh drawing into the editor. */
export default function CanvasEditor({
  item,
  items,
  refresh,
}: {
  item: StudioItem;
  items: StudioItem[];
  refresh: () => Promise<void>;
}) {
  const t = useText();
  const { busy, run } = useAction();
  const [base, setBase] = useState(item);
  const [body, setBody] = useState<StudioBody>(() => structuredClone(item.body));
  const [initial, setInitial] = useState(() => structuredClone(item.body));
  const [mount, setMount] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [saveRevision, setSaveRevision] = useState(0);
  const [history, setHistory] = useState<StudioVersion[] | null>(null);
  const [inserting, setInserting] = useState(false);
  const [input, setInput] = useState('');
  const [format, setFormat] = useState('markdown');
  const [candidate, setCandidate] = useState<PlaitElement[] | null>(null);
  const saving = useRef(false);
  const bodyRef = useRef(body);
  const baseRef = useRef(base);
  const draftKey = `origin-canvas-${item.id}`;
  const [draft] = useState(() => {
    try {
      return localStorage.getItem(draftKey);
    } catch {
      return null;
    }
  });
  const [showDraft, setShowDraft] = useState(Boolean(draft));
  useUnsaved(dirty);
  const update = (patch: StudioBody): void => {
    const next = { ...bodyRef.current, ...structuredClone(patch) };
    if (JSON.stringify(next) === JSON.stringify(bodyRef.current)) return;
    bodyRef.current = next;
    setBody(next);
    setDirty(true);
    try {
      localStorage.setItem(draftKey, JSON.stringify({ version: baseRef.current.version, body: next }));
    } catch {
      /* Server save remains available if local storage is full. */
    }
  };
  const save = async (): Promise<void> => {
    if (saving.current || conflict || showDraft) return;
    saving.current = true;
    const snapshot = structuredClone(bodyRef.current);
    try {
      validateCanvas(snapshot);
      const updated = await saveItem(baseRef.current, { body: snapshot });
      baseRef.current = updated;
      setBase(updated);
      if (JSON.stringify(bodyRef.current) === JSON.stringify(snapshot)) {
        setDirty(false);
        localStorage.removeItem(draftKey);
      } else {
        localStorage.setItem(draftKey, JSON.stringify({ version: updated.version, body: bodyRef.current }));
      }
      await refresh();
    } catch (error) {
      if (error instanceof Error && error.message === 'VERSION_CONFLICT') setConflict(true);
      throw error;
    } finally {
      saving.current = false;
      if (JSON.stringify(bodyRef.current) !== JSON.stringify(snapshot)) setSaveRevision((n) => n + 1);
    }
  };
  useEffect(() => {
    if (!dirty || conflict || showDraft) return;
    const timer = setTimeout(() => void run(save), 1800);
    return () => clearTimeout(timer);
  }, [body, dirty, saveRevision, conflict, showDraft]);
  useEffect(() => {
    if (!dirty && !saving.current && item.version > baseRef.current.version) {
      const changed = JSON.stringify(item.body) !== JSON.stringify(baseRef.current.body);
      baseRef.current = item;
      setBase(item);
      if (changed) {
        bodyRef.current = structuredClone(item.body);
        setBody(bodyRef.current);
        setInitial(structuredClone(item.body));
        setMount((n) => n + 1);
      }
    }
  }, [item.version, dirty]);
  const replaceBoard = (next: StudioBody): void => {
    update(next);
    setInitial(structuredClone(next));
    setMount((n) => n + 1);
  };
  return (
    <>
      {item.status === 'possibly_stale' && <Alert type='warning' content={t('stale')} />}
      {conflict && (
        <Alert
          type='warning'
          content={
            <div>
              <p>{t('canvasConflict')}</p>
              <Button
                onClick={() => downloadText(JSON.stringify(bodyRef.current, null, 2), `${item.title}-draft.drawnix`)}
              >
                {t('exportDrawing')}
              </Button>
              <Button
                onClick={() =>
                  void run(async () => {
                    await createItem(
                      item.projectId,
                      'canvas',
                      `${item.title.slice(0, 130)} · ${t('draftCopy')}`,
                      bodyRef.current
                    );
                    setDirty(false);
                    setConflict(false);
                    localStorage.removeItem(draftKey);
                    const current = await api<StudioItem>(`/items/${item.id}`);
                    baseRef.current = current;
                    setBase(current);
                    bodyRef.current = structuredClone(current.body);
                    setBody(bodyRef.current);
                    setInitial(structuredClone(current.body));
                    setMount((n) => n + 1);
                    await refresh();
                  }, t('saved'))
                }
              >
                {t('saveAsCopy')}
              </Button>
            </div>
          }
        />
      )}
      {showDraft && (
        <Alert
          type='warning'
          content={
            <div>
              {t('recoveryDraft')}{' '}
              <Button
                onClick={() =>
                  void run(async () => {
                    const parsed = JSON.parse(draft ?? '{}') as { version: number; body: StudioBody };
                    validateCanvas(parsed.body);
                    if (parsed.version !== baseRef.current.version) {
                      downloadText(JSON.stringify(parsed.body, null, 2), `${item.title}-recovery.drawnix`);
                      throw new Error('VERSION_CONFLICT');
                    }
                    replaceBoard(parsed.body);
                    setShowDraft(false);
                  })
                }
              >
                {t('restore')}
              </Button>
              <Button
                onClick={() => {
                  localStorage.removeItem(draftKey);
                  setShowDraft(false);
                }}
              >
                {t('dismiss')}
              </Button>
            </div>
          }
        />
      )}
      <div className={styles.canvasActions}>
        <span className={styles.hint}>
          {t(busy ? 'saving' : dirty ? 'unsaved' : 'saved')} · {t('versionLabel', { version: base.version })}
        </span>
        <div className={styles.actions}>
          <Button
            onClick={() => void run(async () => setHistory(await api<StudioVersion[]>(`/items/${item.id}/versions`)))}
          >
            {t('versions')}
          </Button>
          <Button
            disabled={showDraft || conflict || busy}
            onClick={() => {
              setInput('');
              setCandidate(null);
              setInserting(true);
            }}
          >
            {t('insertFromText')}
          </Button>
          <Button
            onClick={() =>
              downloadText(JSON.stringify({ type: 'drawnix', version: 1, ...body }, null, 2), `${item.title}.drawnix`)
            }
          >
            {t('exportDrawing')}
          </Button>
          <Button
            type='primary'
            loading={busy}
            disabled={!dirty || conflict || showDraft}
            onClick={() => void run(save, t('canvasSaved'))}
          >
            {t('save')}
          </Button>
        </div>
      </div>
      <Select
        disabled={showDraft}
        mode='multiple'
        aria-label={t('linkedSources')}
        placeholder={t('linkedSources')}
        value={Array.isArray(body.sourceIds) ? (body.sourceIds as string[]) : []}
        onChange={(sourceIds) => update({ sourceIds })}
        options={items
          .filter((i) => ['decision', 'citation', 'material'].includes(i.kind))
          .map((i) => ({ label: i.title, value: i.id }))}
      />
      <div className={styles.board}>
        {!showDraft && (
          <BoardBoundary key={mount} message={t('canvasRecovery')}>
            <Suspense fallback={<Empty message={t('loading')} />}>
              <Drawnix
                value={initial.elements as PlaitElement[]}
                viewport={initial.viewport as Viewport | undefined}
                theme={initial.theme as PlaitTheme | undefined}
                initialLanguage='zh'
                tutorial={false}
                onValueChange={(elements) => update({ elements })}
                onViewportChange={(viewport) => update({ viewport })}
                onThemeChange={(themeColorMode) => update({ theme: { themeColorMode } })}
              />
            </Suspense>
          </BoardBoundary>
        )}
      </div>
      <Drawer
        title={t('versions')}
        visible={history !== null}
        onCancel={() => setHistory(null)}
        footer={null}
        width={500}
      >
        {history?.map((v) => (
          <section className={styles.version} key={v.version}>
            <strong>{t('versionLabel', { version: v.version })}</strong>{' '}
            <span>{new Date(v.createdAt).toLocaleString()}</span>
            <p>
              {Array.isArray(v.snapshot.body.elements) ? v.snapshot.body.elements.length : 0} {t('canvasElements')}
            </p>
            <Button
              onClick={() =>
                downloadText(JSON.stringify(v.snapshot.body, null, 2), `${item.title}-v${v.version}.drawnix`)
              }
            >
              {t('exportDrawing')}
            </Button>
            <Button
              disabled={busy || dirty || showDraft || conflict}
              onClick={() =>
                void run(async () => {
                  validateCanvas(v.snapshot.body);
                  const current = await api<StudioItem>(`/items/${item.id}`);
                  const restored = await api<StudioItem>(`/items/${item.id}/restore`, 'POST', {
                    version: current.version,
                    restoreVersion: v.version,
                  });
                  baseRef.current = restored;
                  setBase(restored);
                  bodyRef.current = restored.body;
                  setBody(restored.body);
                  setInitial(structuredClone(restored.body));
                  setMount((n) => n + 1);
                  setDirty(false);
                  localStorage.removeItem(draftKey);
                  setHistory(null);
                  await refresh();
                })
              }
            >
              {t('restore')}
            </Button>
          </section>
        ))}
      </Drawer>
      <Modal
        title={t('insertFromText')}
        visible={inserting}
        onCancel={() => setInserting(false)}
        okText={t('insertPreview')}
        cancelText={t('cancel')}
        okButtonProps={{ disabled: !candidate }}
        confirmLoading={busy}
        onOk={() =>
          void run(async () => {
            if (!candidate) return;
            await save();
            replaceBoard({
              ...bodyRef.current,
              elements: [...(bodyRef.current.elements as PlaitElement[]), ...candidate],
            });
            setInserting(false);
            setCandidate(null);
          })
        }
        style={{ width: 800 }}
      >
        <p>{t('insertHint')}</p>
        <Select
          value={format}
          onChange={(value) => {
            setFormat(value);
            setCandidate(null);
          }}
          options={[
            { label: 'Markdown', value: 'markdown' },
            { label: 'Mermaid', value: 'mermaid' },
          ]}
        />
        <Input.TextArea
          value={input}
          onChange={(value) => {
            setInput(value);
            setCandidate(null);
          }}
          maxLength={50000}
          autoSize={{ minRows: 5, maxRows: 10 }}
          aria-label={t('fromText')}
        />
        <Button
          disabled={!input.trim()}
          loading={busy}
          onClick={() =>
            void run(async () => {
              let elements: PlaitElement[];
              if (format === 'mermaid') {
                const { parseMermaidToDrawnix } = await import('@plait-board/mermaid-to-drawnix');
                const result = await parseMermaidToDrawnix(input);
                elements = result.elements;
              } else {
                const { parseMarkdownToDrawnix } = await import('@plait-board/markdown-to-drawnix');
                const mind = parseMarkdownToDrawnix(input);
                mind.points = [[600, 0]];
                elements = [mind];
              }
              validateCanvas({ elements });
              setCandidate(elements);
            })
          }
        >
          {t('preview')}
        </Button>
        {candidate && (
          <div style={{ height: 320, position: 'relative' }}>
            <BoardBoundary key={JSON.stringify(candidate)} message={t('canvasRecovery')}>
              <Suspense fallback={<Empty message={t('loading')} />}>
                <Drawnix value={candidate} initialLanguage='zh' tutorial={false} />
              </Suspense>
            </BoardBoundary>
          </div>
        )}
      </Modal>
    </>
  );
}
