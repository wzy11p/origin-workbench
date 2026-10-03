import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Modal, Select, Tag, Upload } from '@arco-design/web-react';
import { Plus, UploadOne, LinkOne, FileText } from '@icon-park/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { StudioBody, StudioItem, StudioKind, StudioProject, StudioVersion } from '@/common/types/studio';
import { api, createItem, downloadBlob, downloadText, request, saveItem, uploadMaterial } from '../client';
import { ConfirmButton, Empty, Status, textOf, useAction, useGuard, useText, useUnsaved } from '../common';
import styles from '../studio.module.css';
import { SourceContent, PinnedSource } from './SourceReader';

type Props = {
  projectId: string | null;
  kinds: StudioKind[];
  items: StudioItem[];
  allItems: StudioItem[];
  refresh: () => Promise<void>;
  projects?: StudioProject[];
  focusId?: string;
  openSource?: (id: string, version?: number) => void;
};
export default function Assets({
  projectId,
  kinds,
  items,
  allItems,
  refresh,
  projects = [],
  focusId,
  openSource,
}: Props) {
  const t = useText();
  const guard = useGuard();
  const { busy, run } = useAction();
  const [selected, setSelected] = useState(focusId ?? '');
  useEffect(() => {
    if (focusId) setSelected(focusId);
  }, [focusId]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<StudioKind | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  useUnsaved(Boolean(creating) && Boolean(name || content));
  const visible = items.filter(
    (i) =>
      kinds.includes(i.kind) &&
      !['archived', 'deprecated', 'ignored', 'processed'].includes(i.status) &&
      `${i.title} ${textOf(i.body.content)} ${textOf(i.body.quote)}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase())
  );
  const current = items.find((i) => i.id === selected);
  const primaryKind = kinds[0];
  const createLabel =
    primaryKind === 'material'
      ? 'addNote'
      : primaryKind === 'decision'
        ? 'newDecision'
        : primaryKind === 'artifact'
          ? 'newDocument'
          : primaryKind === 'preference'
            ? 'newPreference'
            : primaryKind === 'insight'
              ? 'newInsight'
              : 'capture';
  const beginCreate = (kind: StudioKind): void =>
    guard(() => {
      setCreating(kind);
      setName('');
      setContent('');
    });
  return (
    <div className={styles.assetWorkspace}>
      <div className={styles.panelHead}>
        <Input.Search
          allowClear
          value={query}
          onChange={setQuery}
          placeholder={t('search')}
          aria-label={t('search')}
          className={styles.search}
        />
        <div className={styles.actions}>
          {primaryKind === 'material' && projectId && (
            <Upload
              accept='.pdf,.docx,.pptx,.xlsx,.csv,.md,.txt,.html,.htm,.png,.jpg,.jpeg'
              showUploadList={false}
              multiple
              beforeUpload={(file) => {
                void run(async () => {
                  const item = await uploadMaterial(projectId, file);
                  await refresh();
                  setSelected(item.id);
                });
                return false;
              }}
            >
              <Button type='primary' icon={<UploadOne size={16} />} loading={busy}>
                {t('addMaterial')}
              </Button>
            </Upload>
          )}
          {primaryKind === 'artifact' && projectId && (
            <Button
              type='primary'
              loading={busy}
              onClick={() =>
                guard(() => {
                  void run(async () => {
                    const item = await api<StudioItem>(`/projects/${projectId}/compile`, 'POST', {});
                    await refresh();
                    setSelected(item.id);
                  });
                })
              }
            >
              {t('compile')}
            </Button>
          )}
          {primaryKind !== 'capture' && (
            <Button icon={<Plus size={16} />} onClick={() => beginCreate(primaryKind)}>
              {t(createLabel)}
            </Button>
          )}
          {primaryKind === 'insight' && <Button onClick={() => beginCreate('assumption')}>{t('newAssumption')}</Button>}
        </div>
      </div>
      {primaryKind === 'material' && <p className={styles.hint}>{t('formats')}</p>}
      {primaryKind === 'artifact' && <p className={styles.hint}>{t('compileHint')}</p>}
      {primaryKind === 'preference' && <p className={styles.hint}>{t('preferenceHint')}</p>}
      {primaryKind === 'capture' && <p className={styles.hint}>{t('inboxHint')}</p>}
      <div className={styles.split}>
        <div className={styles.assetList}>
          {visible.length ? (
            visible.map((item) => (
              <Button
                key={item.id}
                type='text'
                className={`${styles.assetRow} ${current?.id === item.id ? styles.selected : ''}`}
                onClick={() =>
                  guard(() => {
                    setSelected(item.id);
                    if (focusId && openSource) openSource(item.id);
                  })
                }
              >
                <div className={styles.itemHeading}>
                  <span>
                    {item.kind === 'citation' ? <LinkOne size={15} /> : <FileText size={15} />}
                    {item.title}
                  </span>
                  <Status item={item} />
                </div>
                <p>{textOf(item.body.quote) || textOf(item.body.content) || textOf(item.body.reason)}</p>
              </Button>
            ))
          ) : (
            <Empty message={t('noItems')} />
          )}
        </div>
        <div className={styles.detail}>
          {current ? (
            <AssetDetail
              key={current.id}
              item={current}
              allItems={allItems}
              projects={projects}
              refresh={refresh}
              openSource={openSource}
              onCreated={(id) => setSelected(id)}
            />
          ) : (
            <Empty message={t('selectedEmpty')} />
          )}
        </div>
      </div>
      <Modal
        visible={Boolean(creating)}
        title={t(createLabel)}
        onCancel={() => guard(() => setCreating(null))}
        okText={t('create')}
        cancelText={t('cancel')}
        confirmLoading={busy}
        onOk={async () => {
          if (!creating || !name.trim()) return;
          await run(async () => {
            const body: StudioBody =
              creating === 'decision'
                ? { options: ['', ''], selected: '', reason: '', basis: '', counterEvidence: '', sourceIds: [] }
                : { content, sourceIds: [] };
            const item = await createItem(projectId, creating, name, body);
            await refresh();
            setSelected(item.id);
            setCreating(null);
          });
        }}
      >
        <label className={styles.field}>
          {t('title')}
          <Input disabled={busy} aria-label={t('title')} value={name} onChange={setName} maxLength={160} autoFocus />
        </label>
        {creating !== 'decision' && (
          <label className={styles.field}>
            {t('content')}
            <Input.TextArea
              aria-label={t('content')}
              value={content}
              disabled={busy}
              onChange={setContent}
              autoSize={{ minRows: 5, maxRows: 12 }}
              maxLength={1000000}
            />
          </label>
        )}
      </Modal>
    </div>
  );
}

function AssetDetail({
  item,
  allItems,
  projects,
  refresh,
  openSource,
  onCreated,
}: {
  item: StudioItem;
  allItems: StudioItem[];
  projects: StudioProject[];
  refresh: () => Promise<void>;
  openSource?: (id: string, version?: number) => void;
  onCreated: (id: string) => void;
}) {
  const t = useText();
  const { busy, run } = useAction(true);
  const [base, setBase] = useState(item);
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [dirty, setDirty] = useState(false);
  const editRevision = useRef(0);
  const [preview, setPreview] = useState(false);
  const [quote, setQuote] = useState('');
  const [quoteName, setQuoteName] = useState('');
  const [quoteVisible, setQuoteVisible] = useState(false);
  const [quoteVersion, setQuoteVersion] = useState(item.version);
  const [history, setHistory] = useState<StudioVersion[] | null>(null);
  const [comparison, setComparison] = useState<StudioItem | null>(null);
  const [target, setTarget] = useState('');
  const originalRef = useRef<HTMLDivElement>(null);
  useUnsaved(dirty);
  const setField = (key: string, value: unknown): void => {
    editRevision.current++;
    setBody((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  };
  const save = async (): Promise<void> => {
    const submittedRevision = editRevision.current;
    const updated = await saveItem(base, {
      title,
      body,
    });
    setBase(updated);
    if (editRevision.current === submittedRevision) {
      setBody(updated.body);
      setTitle(updated.title);
      setDirty(false);
    }
    await refresh();
  };
  const confirm = async (): Promise<void> => {
    const submittedRevision = editRevision.current;
    const updated = await api<StudioItem>(`/items/${item.id}/confirm`, 'POST', { version: base.version });
    setBase(updated);
    if (editRevision.current === submittedRevision) setBody(updated.body);
    await refresh();
  };
  useEffect(() => {
    if (!dirty && item.version > base.version) {
      setBase(item);
      setBody(item.body);
      setTitle(item.title);
    }
  }, [item.version, dirty]);
  const readonly = ['material', 'citation', 'capture', 'review'].includes(item.kind);
  const options = Array.isArray(body.options) ? body.options.filter((v): v is string => typeof v === 'string') : [];
  const sources = Array.isArray(body.sourceIds) ? body.sourceIds.filter((v): v is string => typeof v === 'string') : [];
  return (
    <>
      <div className={styles.detailTitle}>
        <div>
          <span className={styles.eyebrow}>{t('versionLabel', { version: dirty ? base.version : item.version })}</span>
          <h2>{item.title}</h2>
        </div>
        <Status item={item} />
      </div>
      {item.status === 'possibly_stale' && <Alert type='warning' content={t('stale')} showIcon />}
      {Array.isArray(item.body.staleReasons) && (
        <ul className={styles.hint}>
          {item.body.staleReasons.map((r, index) => (
            <li key={index}>{t('changedSource', { title: String((r as StudioBody).title ?? '') })}</li>
          ))}
        </ul>
      )}
      {['failed', 'interrupted', 'partial'].includes(item.status) && (
        <Alert type='warning' content={t(`errors.${textOf(item.body.error) || 'PARSE_FAILED'}`)} showIcon />
      )}
      <div className={styles.actions}>
        {item.kind === 'material' && Boolean(item.body.fileExtension) && (
          <>
            <Button
              type='text'
              onClick={() =>
                void run(async () =>
                  downloadBlob(
                    await (await request(`/items/${item.id}/file`)).blob(),
                    textOf(item.body.filename) || item.title
                  )
                )
              }
            >
              {t('downloadOriginal')}
            </Button>
            {['queued', 'parsing'].includes(item.status) ? (
              <Button
                onClick={() =>
                  void run(async () => {
                    await api(`/items/${item.id}/cancel`, 'POST', {});
                    await refresh();
                  })
                }
              >
                {t('stop')}
              </Button>
            ) : (
              <Button
                type='text'
                onClick={() =>
                  void run(async () => {
                    await api(`/items/${item.id}/parse`, 'POST', {});
                    await refresh();
                  })
                }
              >
                {t('retry')}
              </Button>
            )}
          </>
        )}
        <Button
          type='text'
          onClick={() => void run(async () => setHistory(await api<StudioVersion[]>(`/items/${item.id}/versions`)))}
        >
          {t('versions')}
        </Button>
        {item.kind === 'artifact' && (
          <>
            <Button type='text' onClick={() => setPreview(!preview)}>
              {t(preview ? 'edit' : 'preview')}
            </Button>
            <Button type='text' onClick={() => downloadText(textOf(body.content), `${title}.md`)}>
              {t('exportMarkdown')}
            </Button>
            {Boolean(item.body.previousArtifact) && (
              <Button
                type='text'
                onClick={() =>
                  void run(async () => {
                    const previous = item.body.previousArtifact as { id: string; version: number };
                    const versions = await api<StudioVersion[]>(`/items/${previous.id}/versions`);
                    const snapshot = versions.find((v) => v.version === previous.version)?.snapshot;
                    if (!snapshot) throw new Error('NOT_FOUND');
                    setComparison(snapshot);
                  })
                }
              >
                {t('comparePrevious')}
              </Button>
            )}
          </>
        )}
      </div>
      {body.importedProvenance && <p className={styles.hint}>{t('importedUnconfirmed')}</p>}
      {readonly ? (
        <>
          {item.kind === 'material' && (
            <>
              <p className={styles.hint}>{t('quoteHint')}</p>
              {item.status === 'partial' && <p>{t('partialHint')}</p>}
              {['queued', 'parsing'].includes(item.status) && <p>{t('parsingHint')}</p>}
              <div
                className={styles.sourceContent}
                ref={originalRef}
                onMouseUp={() => {
                  const selection = window.getSelection();
                  if (selection?.anchorNode && originalRef.current?.contains(selection.anchorNode)) {
                    const selected = selection.toString();
                    setQuote(textOf(item.body.content).includes(selected) ? selected : '');
                  }
                }}
              >
                <SourceContent
                  item={item}
                  onQuote={(paragraph) => {
                    setQuote(paragraph);
                    setQuoteName(paragraph.trim().slice(0, 50));
                    setQuoteVersion(item.version);
                    setQuoteVisible(true);
                  }}
                />
              </div>
              <Button
                disabled={!quote.trim()}
                type='outline'
                onClick={() => {
                  setQuoteName(quote.trim().slice(0, 50));
                  setQuoteVersion(item.version);
                  setQuoteVisible(true);
                }}
              >
                {t('quoteSelection')}
              </Button>
              <p className={styles.hint}>{textOf(item.body.parser)}</p>
            </>
          )}
          {item.kind === 'citation' && (
            <>
              <blockquote className={styles.quote}>{textOf(item.body.quote)}</blockquote>
              <p className={styles.hint}>{t('sourceVersion', { version: item.body.sourceVersion })}</p>
              <PinnedSource citation={item} />
            </>
          )}
          {item.kind === 'capture' && (
            <>
              <div className={styles.sourceContent}>{textOf(item.body.content)}</div>
              {!item.projectId && item.status === 'unprocessed' && (
                <div className={styles.actions}>
                  <Select
                    placeholder={t('assign')}
                    aria-label={t('assign')}
                    value={target || undefined}
                    onChange={setTarget}
                    options={projects.filter((p) => !p.archived).map((p) => ({ label: p.title, value: p.id }))}
                    style={{ width: 200 }}
                  />
                  <Button
                    disabled={!target}
                    type='primary'
                    onClick={() =>
                      void run(async () => {
                        await api(`/items/${item.id}/assign`, 'POST', { projectId: target });
                        await refresh();
                      })
                    }
                  >
                    {t('assign')}
                  </Button>
                  <Button
                    onClick={() =>
                      void run(async () => {
                        await saveItem(item, { status: 'ignored' });
                        await refresh();
                      })
                    }
                  >
                    {t('ignore')}
                  </Button>
                </div>
              )}
            </>
          )}
          {item.kind === 'review' && <div className={styles.sourceContent}>{textOf(item.body.content)}</div>}
        </>
      ) : (
        <div
          className={styles.editor}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void run(save, t('saved'));
            }
          }}
        >
          <label className={styles.field}>
            {t('title')}
            <Input
              aria-label={t('title')}
              value={title}
              maxLength={160}
              onChange={(value) => {
                setTitle(value);
                editRevision.current++;
                setDirty(true);
              }}
            />
          </label>
          {item.kind === 'decision' ? (
            <>
              <label className={styles.field}>
                {t('alternatives')}
                <Input.TextArea
                  aria-label={t('alternatives')}
                  value={options.join('\n')}
                  onChange={(value) => setField('options', value.split('\n'))}
                  autoSize={{ minRows: 3 }}
                />
              </label>
              <label className={styles.field}>
                {t('chosen')}
                <Select
                  aria-label={t('chosen')}
                  value={textOf(body.selected) || undefined}
                  options={options.filter((o) => o.trim()).map((o) => ({ label: o, value: o }))}
                  onChange={(value) => setField('selected', value)}
                />
              </label>
              {(['reason', 'basis', 'counterEvidence'] as const).map((key) => (
                <label className={styles.field} key={key}>
                  {t(key)}
                  <Input.TextArea
                    aria-label={t(key)}
                    value={textOf(body[key])}
                    onChange={(value) => setField(key, value)}
                    autoSize={{ minRows: 2, maxRows: 8 }}
                    maxLength={20000}
                  />
                </label>
              ))}
            </>
          ) : preview && item.kind === 'artifact' ? (
            <div className={styles.markdown}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={(url) =>
                  url.startsWith('origin://item/') ? url : /^(https?:|mailto:|#)/i.test(url) ? url : ''
                }
                components={{
                  a: ({ href, children }) =>
                    href?.startsWith('origin://item/') ? (
                      <Button
                        type='text'
                        onClick={() => {
                          const sourceUrl = new URL(href);
                          const v = Number(sourceUrl.searchParams.get('version'));
                          openSource?.(sourceUrl.pathname.slice(1), v > 0 ? v : undefined);
                        }}
                      >
                        {children}
                      </Button>
                    ) : (
                      <a href={href} target='_blank' rel='noreferrer'>
                        {children}
                      </a>
                    ),
                }}
              >
                {textOf(body.content)}
              </ReactMarkdown>
            </div>
          ) : (
            <label className={styles.field}>
              {t('content')}
              <Input.TextArea
                aria-label={t('content')}
                className={item.kind === 'artifact' ? styles.documentEditor : ''}
                value={textOf(body.content)}
                onChange={(value) => setField('content', value)}
                autoSize={item.kind === 'artifact' ? undefined : { minRows: 6, maxRows: 18 }}
                maxLength={1000000}
              />
            </label>
          )}
          {item.projectId && (
            <label className={styles.field}>
              {t('linkedSources')}
              <Select
                mode='multiple'
                aria-label={t('linkedSources')}
                value={sources}
                onChange={(value) => setField('sourceIds', value)}
                options={allItems
                  .filter(
                    (i) =>
                      i.id !== item.id && ['citation', 'material', 'insight', 'assumption', 'decision'].includes(i.kind)
                  )
                  .map((i) => ({ label: i.title, value: i.id }))}
                allowClear
              />
            </label>
          )}
          <div className={styles.editorFoot}>
            <div className={styles.actions}>
              <Button type='primary' loading={busy} disabled={!dirty} onClick={() => void run(save, t('saved'))}>
                {t('save')}
              </Button>
              {['decision', 'preference', 'artifact', 'insight', 'assumption'].includes(item.kind) &&
                !['confirmed', 'decided', 'current'].includes(base.status) && (
                  <ConfirmButton
                    title={t(
                      item.kind === 'decision'
                        ? 'confirmDecision'
                        : item.kind === 'artifact'
                          ? 'markCurrent'
                          : 'confirm'
                    )}
                    hint={t('confirmHint')}
                    onConfirm={confirm}
                    disabled={dirty}
                  >
                    {t(
                      item.kind === 'decision'
                        ? 'confirmDecision'
                        : item.kind === 'artifact'
                          ? 'markCurrent'
                          : 'confirm'
                    )}
                  </ConfirmButton>
                )}
            </div>
            <span className={styles.hint}>{t(dirty ? 'unsaved' : 'saved')}</span>
          </div>
          {item.kind === 'preference' && (
            <Button
              type='text'
              status='danger'
              onClick={() =>
                void run(async () => {
                  await saveItem(item, { status: 'deprecated' });
                  await refresh();
                })
              }
            >
              {t('disable')}
            </Button>
          )}
        </div>
      )}
      <Modal
        visible={quoteVisible}
        title={t('quoteTitle')}
        onCancel={() => setQuoteVisible(false)}
        okText={t('save')}
        cancelText={t('cancel')}
        onOk={async () => {
          if (!item.projectId || !quoteName.trim()) return;
          await run(async () => {
            const citation = await createItem(item.projectId, 'citation', quoteName, {
              sourceId: item.id,
              sourceVersion: quoteVersion,
              quote,
            });
            await refresh();
            setQuoteVisible(false);
            onCreated(citation.id);
          });
        }}
      >
        <blockquote className={styles.quote}>{quote}</blockquote>
        <p className={styles.hint}>{t('sourceVersion', { version: quoteVersion })}</p>
        <Input aria-label={t('quoteTitle')} value={quoteName} onChange={setQuoteName} maxLength={160} />
      </Modal>
      <Drawer
        visible={comparison !== null}
        width={850}
        title={t('comparePrevious')}
        footer={null}
        onCancel={() => setComparison(null)}
      >
        <p>{t('compareHint')}</p>
        <h3>{t('previousPrd')}</h3>
        <pre className={styles.sourceContent}>{textOf(comparison?.body.content)}</pre>
        <h3>{t('newPrd')}</h3>
        <pre className={styles.sourceContent}>{textOf(body.content)}</pre>
      </Drawer>
      <Drawer
        visible={history !== null}
        width={560}
        title={t('versions')}
        onCancel={() => setHistory(null)}
        footer={null}
      >
        {history?.map((v) => (
          <section key={v.version} className={styles.version}>
            <h3>
              {t('versionLabel', { version: v.version })} <Tag>{new Date(v.createdAt).toLocaleString()}</Tag>
            </h3>
            <pre>{textOf(v.snapshot.body.content) || JSON.stringify(v.snapshot.body, null, 2)}</pre>
            {!readonly && v.version !== item.version && (
              <ConfirmButton
                disabled={dirty}
                title={t('restoreVersion')}
                hint={t('restoreHint')}
                onConfirm={async () => {
                  const updated = await api<StudioItem>(`/items/${item.id}/restore`, 'POST', {
                    version: item.version,
                    restoreVersion: v.version,
                  });
                  setBase(updated);
                  setBody(updated.body);
                  setTitle(updated.title);
                  setHistory(null);
                  await refresh();
                }}
              >
                {t('restoreVersion')}
              </ConfirmButton>
            )}
          </section>
        ))}
      </Drawer>
    </>
  );
}
