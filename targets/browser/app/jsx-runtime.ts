import { jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime';
import {
  createElement as reactCreateElement,
  type ElementType,
  type ReactNode,
  type Attributes,
} from 'react';
import { browserHref } from './environment';
export { Fragment } from 'react/jsx-runtime';
function propsFor(type: Parameters<typeof reactJsx>[0], props: unknown) {
  if (type !== 'a' || !props || typeof props !== 'object') return props;
  const anchor = props as { href?: unknown };
  return typeof anchor.href === 'string' ? { ...anchor, href: browserHref(anchor.href) } : props;
}
export const jsx: typeof reactJsx = (type, props, key) =>
  reactJsx(type, propsFor(type, props), key);
export const jsxs: typeof reactJsxs = (type, props, key) =>
  reactJsxs(type, propsFor(type, props), key);
export function createElement(type: ElementType, props: unknown, ...children: ReactNode[]) {
  return reactCreateElement(type, propsFor(type, props) as Attributes, ...children);
}
