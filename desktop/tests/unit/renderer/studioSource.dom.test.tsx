import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { StudioItem } from '@/common/types/studio';
import { SourceContent } from '@/renderer/pages/Studio/panels/SourceReader';

vi.mock('@/renderer/pages/Studio/common', () => ({
  useText: () => (key: string) => key,
  textOf: (value: unknown) => (typeof value === 'string' ? value : ''),
  useAction: () => ({ busy: false, run: (action: () => Promise<unknown>) => action() }),
}));
vi.mock('@/renderer/pages/Studio/client', () => ({ api: vi.fn() }));
afterEach(cleanup);

const material: StudioItem = {
  id: 'source',
  projectId: 'project',
  kind: 'material',
  title: '访谈',
  status: 'ready',
  version: 3,
  body: { content: '我希望资料和决定放在一起。', blocks: [{ id: 'b1', text: '我希望资料和决定放在一起。', page: 2 }] },
  createdAt: '2026-09-22T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z',
};
describe('normal source reading', () => {
  it('offers a keyboard-accessible action that quotes the literal paragraph', () => {
    const onQuote = vi.fn();
    render(<SourceContent item={material} onQuote={onQuote} />);
    const button = screen.getByRole('button', { name: 'quoteParagraph' });
    button.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(onQuote).toHaveBeenCalledWith('我希望资料和决定放在一起。');
    expect(screen.getByText('pageLabel')).toBeInTheDocument();
  });
});
describe('adversarial source reading', () => {
  it('does not offer a quote action for a block absent from the saved original', () => {
    render(
      <SourceContent
        item={{ ...material, body: { ...material.body, blocks: [{ id: 'bad', text: '编造的结论' }] } }}
        onQuote={vi.fn()}
      />
    );
    expect(screen.queryByRole('button', { name: 'quoteParagraph' })).not.toBeInTheDocument();
  });
  it('keeps historical source drawers read-only when no quote action is provided', () => {
    render(<SourceContent item={material} />);
    expect(screen.getByText('我希望资料和决定放在一起。')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
