import React, { useState } from 'react';
import { Button, Drawer } from '@arco-design/web-react';
import type { StudioItem, StudioVersion } from '@/common/types/studio';
import { api } from '../client';
import { textOf, useAction, useText } from '../common';
import styles from '../studio.module.css';
import { BLUEPRINT_FIELDS } from '@/common/studio/blueprint';

export function StructuredSource({ item }: { item: StudioItem }) {
  const t = useText();
  const fields: { label: string; value: string }[] = [];
  if (item.kind === 'blueprint') {
    const values = item.body.fields as Record<string, string>;
    for (const key of BLUEPRINT_FIELDS)
      fields.push({ label: t(`blueprintFields.${key}`), value: textOf(values?.[key]) });
  } else if (item.kind === 'requirement') {
    for (const key of ['content', 'normal', 'adverse'])
      fields.push({ label: t(`requirementFields.${key}`), value: textOf(item.body[key]) });
  } else if (item.kind === 'validation') {
    for (const key of ['hypothesis', 'method', 'threshold', 'result', 'conclusion'])
      fields.push({ label: t(`validationFields.${key}`), value: textOf(item.body[key]) });
    fields.push({ label: t('nextDecision'), value: t(`outcome.${String(item.body.outcome)}`) });
  } else if (item.kind === 'decision') {
    for (const [key, label] of [
      ['selected', 'chosen'],
      ['reason', 'reason'],
      ['basis', 'basis'],
      ['counterEvidence', 'counterEvidence'],
    ])
      fields.push({ label: t(label), value: textOf(item.body[key]) });
    fields.push({
      label: t('alternatives'),
      value: Array.isArray(item.body.options) ? item.body.options.join('\n') : '',
    });
  } else if (item.kind === 'canvas') {
    fields.push({
      label: t('canvas'),
      value: `${Array.isArray(item.body.elements) ? item.body.elements.length : 0} ${t('canvasElements')}`,
    });
  } else fields.push({ label: t('content'), value: textOf(item.body.content) || textOf(item.body.quote) });
  return (
    <dl className={styles.sourceContent}>
      {fields.map((field) => (
        <div key={field.label}>
          <dt>
            <strong>{field.label}</strong>
          </dt>
          <dd>
            <p>{field.value || t('fieldOpen')}</p>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function SourceContent({ item, onQuote }: { item: StudioItem; onQuote?: (quote: string) => void }) {
  const t = useText();
  const content = textOf(item.body.content);
  const blocks =
    Array.isArray(item.body.blocks) && item.body.blocks.length
      ? (item.body.blocks as { id: string; text: string; page?: number }[])
      : [{ id: 'content', text: content }];
  return (
    <>
      {blocks.map((block) => (
        <section key={block.id} className={styles.sourceBlock}>
          {block.page && <span className={styles.hint}>{t('pageLabel', { page: block.page })}</span>}
          <p>{block.text}</p>
          {onQuote && block.text.trim() && content.includes(block.text) && (
            <Button type='text' size='mini' className={styles.quoteBlock} onClick={() => onQuote(block.text)}>
              {t('quoteParagraph')}
            </Button>
          )}
        </section>
      ))}
    </>
  );
}
export function PinnedSource({ citation }: { citation: StudioItem }) {
  const t = useText();
  const { busy, run } = useAction();
  const [snapshot, setSnapshot] = useState<StudioItem | null>(null);
  return (
    <>
      <Button
        type='text'
        loading={busy}
        onClick={() =>
          void run(async () => {
            const versions = await api<StudioVersion[]>(`/items/${String(citation.body.sourceId)}/versions`);
            const found = versions.find((v) => v.version === citation.body.sourceVersion);
            if (!found) throw new Error('INVALID_REFERENCE');
            setSnapshot(found.snapshot);
          })
        }
      >
        {t('viewSource')} · {t('sourceVersion', { version: citation.body.sourceVersion })}
      </Button>
      <Drawer
        title={snapshot?.title ?? t('source')}
        visible={snapshot !== null}
        onCancel={() => setSnapshot(null)}
        footer={null}
        width={640}
      >
        <blockquote className={styles.quote}>{textOf(citation.body.quote)}</blockquote>
        <p className={styles.hint}>{t('sourceVersion', { version: citation.body.sourceVersion })}</p>
        {snapshot && (
          <div className={styles.sourceContent}>
            <SourceContent item={snapshot} />
          </div>
        )}
      </Drawer>
    </>
  );
}
