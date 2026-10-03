import React, { useEffect, useState } from 'react';
import { Button, Input, Modal, Select, Upload } from '@arco-design/web-react';
import type { PlaitElement, PlaitTheme, Viewport } from '@plait/core';
import type { StudioItem } from '@/common/types/studio';
import { createItem } from '../client';
import { Empty, useAction, useGuard, useText, useUnsaved } from '../common';
import styles from '../studio.module.css';
import CanvasEditor from './CanvasEditor';
import { validateCanvas } from '@/common/studio/canvas';

export default function Canvas({
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
  const canvases = items.filter((i) => i.kind === 'canvas');
  const [active, setActive] = useState('');
  useEffect(() => {
    if (focusId) setActive(focusId);
  }, [focusId]);
  const [show, setShow] = useState(false);
  const [title, setTitle] = useState('');
  const [markdown, setMarkdown] = useState('');
  useUnsaved(show && Boolean(title || markdown));
  const current = canvases.find((i) => i.id === active) ?? canvases[0];
  const create = async (elements: PlaitElement[] = []): Promise<void> => {
    const item = await createItem(projectId, 'canvas', title.trim() || t('blankCanvas'), { elements, sourceIds: [] });
    await refresh();
    setActive(item.id);
    setShow(false);
  };
  return (
    <div className={styles.canvasWorkspace}>
      <div className={styles.panelHead}>
        <Select
          aria-label={t('canvas')}
          placeholder={t('canvas')}
          value={current?.id}
          onChange={(id) => guard(() => setActive(id))}
          options={canvases.map((i) => ({ label: i.title, value: i.id }))}
          style={{ width: 260 }}
        />
        <div className={styles.actions}>
          <Upload
            accept='.drawnix,.json'
            showUploadList={false}
            beforeUpload={(file) => {
              guard(() => {
                void run(async () => {
                  const data = JSON.parse(await file.text()) as {
                    elements?: PlaitElement[];
                    viewport?: Viewport;
                    theme?: PlaitTheme;
                  };
                  validateCanvas(data);
                  const item = await createItem(projectId, 'canvas', file.name, {
                    elements: data.elements,
                    viewport: data.viewport,
                    theme: data.theme,
                    sourceIds: [],
                  });
                  await refresh();
                  setActive(item.id);
                });
              });
              return false;
            }}
          >
            <Button>{t('importDrawing')}</Button>
          </Upload>
          <Button
            type='primary'
            onClick={() =>
              guard(() => {
                setTitle('');
                setMarkdown('');
                setShow(true);
              })
            }
          >
            {t('newCanvas')}
          </Button>
        </div>
      </div>
      <p className={styles.hint}>{t('canvasHint')}</p>
      {current ? (
        <CanvasEditor key={current.id} item={current} items={items} refresh={refresh} />
      ) : (
        <Empty message={t('noItems')} action={<Button onClick={() => setShow(true)}>{t('newCanvas')}</Button>} />
      )}
      <Modal
        title={t('newCanvas')}
        visible={show}
        onCancel={() => guard(() => setShow(false))}
        okText={t('create')}
        cancelText={t('cancel')}
        confirmLoading={busy}
        onOk={() =>
          run(async () => {
            if (markdown.trim()) {
              const { parseMarkdownToDrawnix } = await import('@plait-board/markdown-to-drawnix');
              const mind = parseMarkdownToDrawnix(markdown);
              mind.points = [[0, 0]];
              await create([mind]);
            } else await create();
          })
        }
      >
        <label className={styles.field}>
          {t('title')}
          <Input disabled={busy} value={title} onChange={setTitle} aria-label={t('title')} maxLength={160} />
        </label>
        <label className={styles.field}>
          {t('fromText')}
          <Input.TextArea
            value={markdown}
            disabled={busy}
            onChange={setMarkdown}
            aria-label={t('fromText')}
            placeholder={t('markdownHint')}
            autoSize={{ minRows: 6, maxRows: 12 }}
            maxLength={50000}
          />
        </label>
      </Modal>
    </div>
  );
}
