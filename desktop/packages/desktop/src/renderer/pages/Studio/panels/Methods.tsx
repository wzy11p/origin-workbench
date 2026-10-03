import React, { useEffect, useRef, useState } from 'react';
import { Button, Collapse, Input, Tag } from '@arco-design/web-react';
import { ArrowRight } from '@icon-park/react';
import ReactMarkdown from 'react-markdown';
import type { StudioItem, StudioMethod } from '@/common/types/studio';
import { api } from '../client';
import { Empty, Status, textOf, useAction, useGuard, useText, useUnsaved } from '../common';
import styles from '../studio.module.css';

export default function Methods({
  projectId,
  items,
  refresh,
  focusId,
}: {
  projectId: string;
  items: StudioItem[];
  refresh: () => Promise<void>;
  focusId?: string;
}) {
  const t = useText();
  const guard = useGuard();
  const { busy, run } = useAction();
  const [methods, setMethods] = useState<StudioMethod[]>([]);
  const [method, setMethod] = useState<StudioMethod | null>(null);
  const [active, setActive] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (focusId && items.some((i) => i.id === focusId && i.kind === 'workflow')) {
      setActive(focusId);
      setMethod(null);
    }
  }, [focusId]);
  useEffect(() => {
    void run(async () => setMethods(await api<StudioMethod[]>('/methods')));
  }, []);
  const workflows = items.filter((i) => i.kind === 'workflow');
  const workflow = workflows.find((i) => i.id === active);
  return (
    <div className={styles.methodWorkspace}>
      <p className={styles.hint}>{t('methodHint')}</p>
      <div className={styles.split}>
        <div className={styles.methodList}>
          <h3>{t('workflows')}</h3>
          {workflows.length ? (
            workflows.map((i) => (
              <Button
                key={i.id}
                type='text'
                className={`${styles.assetRow} ${active === i.id ? styles.selected : ''}`}
                onClick={() =>
                  guard(() => {
                    setActive(i.id);
                    setMethod(null);
                  })
                }
              >
                <div className={styles.itemHeading}>
                  <span>{i.title}</span>
                  <Status item={i.body.complete ? { status: 'completed' } : i} />
                </div>
              </Button>
            ))
          ) : (
            <p className={styles.hint}>{t('noItems')}</p>
          )}
          <h3>{t('library')}</h3>
          <Input.Search
            placeholder={t('search')}
            aria-label={t('search')}
            value={query}
            onChange={setQuery}
            allowClear
          />
          <p className={styles.hint}>{t('methodCount', { count: methods.length })}</p>
          {methods
            .filter((m) => `${m.title} ${m.description} ${m.id}`.toLowerCase().includes(query.toLowerCase()))
            .map((m) => (
              <Button
                key={m.id}
                type='text'
                className={`${styles.methodRow} ${method?.id === m.id ? styles.selected : ''}`}
                onClick={() =>
                  guard(() => {
                    setActive('');
                    void run(async () => setMethod(await api<StudioMethod>(`/methods/${m.id}`)));
                  })
                }
              >
                <strong>{m.title}</strong>
                <span>{m.description}</span>
              </Button>
            ))}
        </div>
        <div className={styles.detail}>
          {workflow ? (
            <MethodRunner key={workflow.id} workflow={workflow} refresh={refresh} />
          ) : method ? (
            <>
              <span className={styles.eyebrow}>PM Skills</span>
              <h2>{method.title}</h2>
              <p className={styles.intro}>{method.description}</p>
              <ol className={styles.methodSteps}>
                {method.steps.map((s, i) => (
                  <li key={i}>{s.question}</li>
                ))}
              </ol>
              <Button
                type='primary'
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    const saved = await api<StudioItem>(`/projects/${projectId}/workflows`, 'POST', {
                      methodId: method.id,
                    });
                    await refresh();
                    setActive(saved.id);
                    setMethod(null);
                  })
                }
              >
                {t('startMethod')}
                <ArrowRight size={16} />
              </Button>
              <MethodSource content={method.content} source={method.source} />
            </>
          ) : (
            <Empty message={t('selectedEmpty')} />
          )}
        </div>
      </div>
    </div>
  );
}
function MethodSource({ content, source }: { content: string; source: string }) {
  const t = useText();
  return (
    <Collapse className={styles.methodSource} bordered={false}>
      <Collapse.Item name='source' header={t('methodSource')}>
        <p className={styles.hint}>{source}</p>
        <div className={styles.markdown}>
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </Collapse.Item>
    </Collapse>
  );
}
function MethodRunner({ workflow, refresh }: { workflow: StudioItem; refresh: () => Promise<void> }) {
  const t = useText();
  const { busy, run } = useAction(true);
  const [base, setBase] = useState(workflow);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(
    Array.isArray(workflow.body.answers) ? workflow.body.answers.map(textOf) : []
  );
  const [dirty, setDirty] = useState(false);
  const editRevision = useRef(0);
  useUnsaved(dirty);
  const steps = (Array.isArray(workflow.body.steps) ? workflow.body.steps : []) as StudioMethod['steps'];
  const save = async (complete: boolean): Promise<void> => {
    const submittedRevision = editRevision.current;
    const updated = await api<StudioItem>(`/items/${base.id}/workflow`, 'POST', {
      version: base.version,
      answers,
      complete,
    });
    setBase(updated);
    if (submittedRevision === editRevision.current) setDirty(false);
    await refresh();
  };
  return (
    <>
      <div className={styles.detailTitle}>
        <div>
          <span className={styles.eyebrow}>{t('pinnedMethod')}</span>
          <h2>{workflow.title}</h2>
        </div>
        <Tag>{t('step', { current: step + 1, total: steps.length })}</Tag>
      </div>
      <div className={styles.stepDots}>
        {steps.map((_s, i) => (
          <Button
            key={i}
            size='small'
            type={step === i ? 'primary' : answers[i]?.trim() ? 'outline' : 'secondary'}
            onClick={() => setStep(i)}
          >
            {i + 1}
          </Button>
        ))}
      </div>
      <h3 className={styles.stepQuestion}>{steps[step]?.question}</h3>
      <Input.TextArea
        aria-label={t('answer')}
        value={answers[step] ?? ''}
        onChange={(value) => {
          editRevision.current++;
          setAnswers((previous) => steps.map((_s, i) => (i === step ? value : (previous[i] ?? ''))));
          setDirty(true);
        }}
        placeholder={t('answer')}
        autoSize={{ minRows: 10, maxRows: 20 }}
        maxLength={100000}
      />
      <div className={styles.editorFoot}>
        <div className={styles.actions}>
          <Button disabled={step === 0} onClick={() => setStep(step - 1)}>
            {t('previous')}
          </Button>
          <Button disabled={step === steps.length - 1} onClick={() => setStep(step + 1)}>
            {t('next')}
          </Button>
        </div>
        <div className={styles.actions}>
          <Button loading={busy} disabled={!dirty} onClick={() => void run(() => save(false), t('saved'))}>
            {t('save')}
          </Button>
          <Button
            type='primary'
            loading={busy}
            disabled={answers.length !== steps.length || answers.some((a) => !a.trim())}
            onClick={() => void run(() => save(true), t('status.completed'))}
          >
            {t('finishMethod')}
          </Button>
        </div>
      </div>
      <p className={styles.hint}>{t(dirty ? 'unsaved' : 'saved')}</p>
      <MethodSource content={textOf(workflow.body.methodContent)} source={textOf(workflow.body.methodSource)} />
    </>
  );
}
