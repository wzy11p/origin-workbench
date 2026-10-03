import React, { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Input, Select, Tabs } from '@arco-design/web-react';
import { ArrowRight, Download } from '@icon-park/react';
import {
  BLUEPRINT_FIELDS,
  concreteText,
  inspectPlan,
  resolveBlueprint,
  type BlueprintField,
} from '@/common/studio/blueprint';
import type { StudioItem, StudioProject } from '@/common/types/studio';
import { api, downloadBlob, request } from '../../client';
import { useAction, useGuard, useText, useUnsaved } from '../../common';
import Requirements from './Requirements';
import Validation from './Validation';
import styles from './planning.module.css';

type Props = {
  project: StudioProject;
  items: StudioItem[];
  refresh: () => Promise<void>;
  openSource: (id: string) => void;
  focusId?: string;
};
export default function Planning(props: Props) {
  const { project, items, refresh, openSource, focusId } = props;
  const t = useText();
  const guard = useGuard();
  const { busy, run } = useAction(true);
  const [step, setStep] = useState('blueprint');
  const [field, setField] = useState<BlueprintField | undefined>();
  const [artifactId, setArtifactId] = useState('');
  const inspection = inspectPlan(project, items);
  const documents = items
    .filter((i) => i.kind === 'artifact' && i.status !== 'archived')
    .toSorted((a, b) => b.createdAt - a.createdAt);
  const artifact = documents.find((i) => i.id === artifactId) ?? documents[0];
  useEffect(() => {
    const target = items.find((i) => i.id === focusId);
    if (target)
      setStep(
        target.kind === 'requirement' ? 'requirements' : target.kind === 'validation' ? 'validation' : 'blueprint'
      );
  }, [focusId]);
  return (
    <section className={styles.planning}>
      <div className={styles.heading}>
        <div>
          <h2>{t('creationPath')}</h2>
          <p>{t('creationPathHint')}</p>
        </div>
        <span className={styles.hint}>{t('planProgress', { count: inspection.requirementCount })}</span>
      </div>
      <Tabs type='text' activeTab={step} onChange={(value) => guard(() => setStep(value))}>
        {['blueprint', 'requirements', 'handoff', 'validation'].map((key, i) => (
          <Tabs.TabPane key={key} title={`${i + 1}. ${t(key)}`} />
        ))}
      </Tabs>
      {step === 'blueprint' && <BlueprintEditor key={project.id} {...props} preferredField={field} />}
      {step === 'requirements' && <Requirements {...props} />}
      {step === 'validation' && <Validation {...props} />}
      {step === 'handoff' && (
        <div className={styles.readiness}>
          <h3>{t(inspection.ready ? 'structureReady' : 'gapsTitle', { count: inspection.gaps.length })}</h3>
          <p className={styles.hint}>{t('readinessHint')}</p>
          <ul className={styles.gapList}>
            {inspection.gaps.map((gap, i) => (
              <li key={`${gap.code}-${gap.field || gap.itemId || i}`}>
                <span>
                  {t(`gap.${gap.code}`)}
                  {gap.field ? ` · ${t(`blueprintFields.${gap.field}`)}` : gap.title ? ` · ${gap.title}` : ''}
                </span>
                <Button
                  type='text'
                  onClick={() => {
                    if (gap.field) {
                      setField(gap.field);
                      setStep('blueprint');
                    } else if (gap.code === 'noRequirements' || gap.code.startsWith('missing')) setStep('requirements');
                    else if (gap.itemId) openSource(gap.itemId);
                  }}
                >
                  {t('goComplete')}
                  <ArrowRight size={14} />
                </Button>
              </li>
            ))}
          </ul>
          <div className={styles.section}>
            <h3>{t('preparePrd')}</h3>
            <p>{t('regenerateHint')}</p>
            <Button
              type='primary'
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const next = await api<StudioItem>(`/projects/${project.id}/compile`, 'POST', {});
                  await refresh();
                  setArtifactId(next.id);
                }, t('newPrdSaved'))
              }
            >
              {t('compile')}
            </Button>
          </div>
          <div className={styles.section}>
            <h3>{t('handoff')}</h3>
            <p>{t('handoffHint')}</p>
            {documents.length ? (
              <>
                <Select
                  aria-label={t('chooseDocument')}
                  value={artifact?.id}
                  onChange={setArtifactId}
                  options={documents.map((d) => ({
                    value: d.id,
                    label: `${d.title} · ${new Date(d.createdAt).toLocaleString()} · v${d.version}`,
                  }))}
                />
                <div className={styles.actions}>
                  <Button onClick={() => artifact && openSource(artifact.id)}>{t('preview')}</Button>
                  <Button
                    icon={<Download size={15} />}
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        if (!artifact) return;
                        const response = await request(`/projects/${project.id}/handoff?artifact=${artifact.id}`);
                        downloadBlob(await response.blob(), `${project.title}-交付包.zip`);
                      })
                    }
                  >
                    {t('exportHandoff')}
                  </Button>
                </div>
                {(!inspection.ready || artifact?.status === 'possibly_stale') && (
                  <Alert type='warning' content={t('draftHandoff')} />
                )}
              </>
            ) : (
              <p className={styles.hint}>{t('generateFirst')}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function BlueprintEditor({ project, items, refresh, preferredField }: Props & { preferredField?: BlueprintField }) {
  const t = useText();
  const guard = useGuard();
  const { busy, run } = useAction(true);
  const view = resolveBlueprint(project, items);
  const [field, setField] = useState<BlueprintField>(
    preferredField ?? inspectPlan(project, items).nextField ?? 'summary'
  );
  const [value, setValue] = useState(view.fields[field].value);
  const [version, setVersion] = useState(view.item?.version ?? 0);
  const [dirty, setDirty] = useState(false);
  useUnsaved(dirty);
  useEffect(() => {
    if (!dirty) {
      setValue(view.fields[field].value);
      setVersion(view.item?.version ?? 0);
    }
  }, [view.item?.version, view.fields[field].value, field, dirty]);
  useEffect(() => {
    if (preferredField) setField(preferredField);
  }, [preferredField]);
  const select = (key: BlueprintField): void =>
    guard(() => {
      setDirty(false);
      setField(key);
    });
  const save = async (text: string): Promise<void> => {
    await api(`/projects/${project.id}/blueprint`, 'POST', { version, fields: { [field]: text } });
    await refresh();
    setDirty(false);
  };
  return (
    <div className={styles.blueprint}>
      <nav className={styles.fieldNav} aria-label={t('blueprint')}>
        {BLUEPRINT_FIELDS.map((key) => (
          <Button
            key={key}
            type='text'
            disabled={busy}
            className={key === field ? styles.selected : ''}
            onClick={() => select(key)}
          >
            <span>{t(`blueprintFields.${key}`)}</span>
            <span className={styles.hint}>
              {t(concreteText(view.fields[key].value) ? 'fieldRecorded' : 'fieldOpen')}
            </span>
          </Button>
        ))}
      </nav>
      <div className={styles.fieldEditor}>
        <h3>{t(`blueprintQuestions.${field}`)}</h3>
        <p className={styles.hint}>{t(view.fields[field].origin === 'method' ? 'reusedMethod' : 'oneQuestionHint')}</p>
        <Input.TextArea
          aria-label={t(`blueprintFields.${field}`)}
          value={value}
          disabled={busy}
          onChange={(text) => {
            setValue(text);
            setDirty(true);
          }}
          maxLength={100000}
          autoSize={{ minRows: 6, maxRows: 16 }}
        />
        <div className={styles.actions}>
          <Button
            type='primary'
            loading={busy}
            onClick={() =>
              void run(async () => {
                await save(value);
                const next = BLUEPRINT_FIELDS[(BLUEPRINT_FIELDS.indexOf(field) + 1) % BLUEPRINT_FIELDS.length];
                setField(next);
              }, t('saved'))
            }
          >
            {t('saveAndContinue')}
            <ArrowRight size={15} />
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              guard(() => {
                setDirty(false);
                setField(BLUEPRINT_FIELDS[(BLUEPRINT_FIELDS.indexOf(field) + 1) % BLUEPRINT_FIELDS.length]);
              })
            }
          >
            {t('answerLater')}
          </Button>
        </div>
        <p className={styles.hint}>{t(dirty ? 'unsaved' : 'blueprintReuseHint')}</p>
        <Collapse bordered={false}>
          <Collapse.Item name='all' header={t('readBlueprint')}>
            {BLUEPRINT_FIELDS.map((key) => (
              <div className={styles.readField} key={key}>
                <h4>{t(`blueprintFields.${key}`)}</h4>
                <p>{view.fields[key].value || t('fieldOpen')}</p>
              </div>
            ))}
          </Collapse.Item>
        </Collapse>
      </div>
    </div>
  );
}
