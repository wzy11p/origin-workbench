import React, { useEffect, useState } from 'react';
import { Button, Collapse, Input, Select } from '@arco-design/web-react';
import ReactMarkdown from 'react-markdown';
import type { StudioItem, StudioModel, StudioProject } from '@/common/types/studio';
import { effectivePreferences } from '@/common/studio/preferences';
import { api, createItem } from '../client';
import { Empty, Status, textOf, useAction, useText, useUnsaved } from '../common';
import styles from '../studio.module.css';

type ReviewResult = {
  target: StudioModel;
  content: string;
  status: string;
  error?: string;
  attempts?: { content: string; status: string; error?: string }[];
};
export default function Review({
  project,
  items,
  preferences,
  refresh,
}: {
  project: StudioProject;
  items: StudioItem[];
  preferences: StudioItem[];
  refresh: () => Promise<void>;
}) {
  const t = useText();
  const { busy, run } = useAction();
  const [models, setModels] = useState<StudioModel[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  useEffect(() => {
    void run(async () => setModels(await api<StudioModel[]>('/models')));
  }, []);
  const context = (): void => {
    const confirmed = items.filter(
      (i) =>
        (i.kind === 'decision' && i.status === 'decided') ||
        i.kind === 'citation' ||
        (i.kind === 'insight' && i.status === 'confirmed')
    );
    const prefs = effectivePreferences(preferences, project.id).active;
    setPrompt(
      `${t('userConfirmedOnly')}\n\n${project.title}\n${project.intent}\n\n${confirmed.map((i) => `${i.title}\n${i.kind === 'decision' ? JSON.stringify({ choice: i.body.selected, reason: i.body.reason, basis: i.body.basis }) : textOf(i.body.quote) || textOf(i.body.content)}`).join('\n\n')}\n\n${prefs.map((i) => `${i.title}: ${textOf(i.body.content)}`).join('\n')}`
    );
    setDirty(true);
  };
  const reviews = items.filter((i) => i.kind === 'review');
  return (
    <div className={styles.review}>
      <p className={styles.intro}>{t('modelHint')}</p>
      {!models.length ? (
        <Empty
          message={t('noModels')}
          action={
            <Button type='primary' href='#/settings/model'>
              {t('configureModels')}
            </Button>
          }
        />
      ) : (
        <>
          <label className={styles.field}>
            {t('modelSelect')}
            <Select
              mode='multiple'
              aria-label={t('modelSelect')}
              value={chosen}
              onChange={(values) => setChosen(values.slice(0, 4))}
              options={models.map((m, i) => ({ label: `${m.providerName} · ${m.model}`, value: String(i) }))}
            />
          </label>
          <div className={styles.sectionHead}>
            <label htmlFor='review-prompt'>{t('reviewPrompt')}</label>
            <Button type='text' onClick={context}>
              {t('useProjectContext')}
            </Button>
          </div>
          <Input.TextArea
            id='review-prompt'
            value={prompt}
            onChange={(value) => {
              setPrompt(value);
              setDirty(true);
            }}
            autoSize={{ minRows: 8, maxRows: 16 }}
            maxLength={100000}
          />
          <div className={styles.editorFoot}>
            <span className={styles.hint}>{prompt.length.toLocaleString()}</span>
            <Button
              type='primary'
              loading={busy}
              disabled={!prompt.trim() || !chosen.length}
              onClick={() =>
                void run(async () => {
                  await api(`/projects/${project.id}/review`, 'POST', {
                    prompt,
                    targets: chosen.map((i) => models[Number(i)]),
                  });
                  setDirty(false);
                  await refresh();
                })
              }
            >
              {t('runReview')}
            </Button>
          </div>
        </>
      )}
      <h2>{t('reviewHistory')}</h2>
      {reviews.map((item) => (
        <section key={item.id} className={styles.reviewRun}>
          <div className={styles.sectionHead}>
            <h3>{item.title}</h3>
            <div className={styles.actions}>
              <Status item={item} />
              {item.status === 'running' && (
                <Button
                  onClick={() =>
                    void run(async () => {
                      await api(`/items/${item.id}/cancel-review`, 'POST', {});
                      await refresh();
                    })
                  }
                >
                  {t('stop')}
                </Button>
              )}
            </div>
          </div>
          <Collapse bordered={false}>
            <Collapse.Item name='prompt' header={t('reviewPrompt')}>
              <pre>{textOf(item.body.prompt)}</pre>
            </Collapse.Item>
          </Collapse>
          <div className={styles.reviewResults}>
            {(Array.isArray(item.body.results) ? (item.body.results as ReviewResult[]) : []).map((result, i) => (
              <article key={i}>
                <h3>
                  {result.target.providerName} · {result.target.model}
                </h3>
                <Status item={{ status: result.status }} />
                <div className={styles.markdown}>
                  <ReactMarkdown>{result.content}</ReactMarkdown>
                </div>
                {result.error && <p className={styles.hint}>{t(`errors.${result.error}`)}</p>}
                <div className={styles.actions}>
                  {['failed', 'cancelled', 'interrupted'].includes(result.status) && item.status !== 'running' && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`/items/${item.id}/retry-review`, 'POST', { index: i });
                          await refresh();
                        })
                      }
                    >
                      {t('retry')}
                    </Button>
                  )}
                  {result.content && (
                    <Button
                      onClick={() =>
                        void run(async () => {
                          await createItem(project.id, 'insight', item.title.slice(0, 120), {
                            content: result.content,
                            sourceIds: [item.id],
                            modelGenerated: true,
                            reviewTarget: result.target,
                            reviewVersion: item.version,
                          });
                          await refresh();
                        }, t('candidateSaved'))
                      }
                    >
                      {t('saveSuggestion')}
                    </Button>
                  )}
                </div>
                {!!result.attempts?.length && (
                  <Collapse>
                    <Collapse.Item name='attempts' header={t('previousAttempts')}>
                      {result.attempts.map((a, index) => (
                        <section key={index}>
                          <Status item={{ status: a.status }} />
                          <pre>{a.content}</pre>
                        </section>
                      ))}
                    </Collapse.Item>
                  </Collapse>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
