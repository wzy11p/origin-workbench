import type { StudioBody } from '../types/studio';
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const point = (v: unknown): boolean =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e8);
/** Reject corrupt imports before mounting third-party drawing plugins. Rendering still has an error boundary. */
export function validateCanvas(body: StudioBody): void {
  const invalid = (): never => {
    throw new Error('INVALID_CANVAS');
  };
  if (!Array.isArray(body.elements) || body.elements.length > 5000) invalid();
  const ids = new Set<string>();
  let count = 0;
  const visit = (value: unknown, depth: number): void => {
    if (!object(value) || depth > 80 || ++count > 10000) invalid();
    const node = value as Record<string, unknown>;
    if (typeof node.id !== 'string' || !node.id || ids.has(node.id)) invalid();
    ids.add(node.id as string);
    if (typeof node.type !== 'string' || !node.type) invalid();
    if (node.points !== undefined && (!Array.isArray(node.points) || !node.points.length || !node.points.every(point)))
      invalid();
    if (depth === 0 && node.type !== 'group' && !Array.isArray(node.points)) invalid();
    if (node.type === 'mindmap' || node.type === 'mind' || node.type === 'mind_child') {
      if (
        !object(node.data) ||
        !object(node.data.topic) ||
        !Array.isArray(node.data.topic.children) ||
        !Array.isArray(node.children)
      )
        invalid();
    }
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) invalid();
      for (const child of node.children as unknown[]) visit(child, depth + 1);
    }
    if (
      node.type === 'image' &&
      (typeof node.url !== 'string' || !/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/.test(node.url))
    )
      invalid();
  };
  for (const element of body.elements as unknown[]) visit(element, 0);
  if (body.viewport !== undefined) {
    const v = body.viewport;
    if (
      !object(v) ||
      typeof v.zoom !== 'number' ||
      !Number.isFinite(v.zoom) ||
      v.zoom <= 0 ||
      v.zoom > 100 ||
      !point(v.origination)
    )
      invalid();
  }
}
