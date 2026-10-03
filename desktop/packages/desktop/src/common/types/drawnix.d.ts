declare module '@drawnix/drawnix' {
  import type { FC } from 'react';
  import type { PlaitElement, PlaitTheme, Viewport, ThemeColorMode } from '@plait/core';
  export const Drawnix: FC<{
    value: PlaitElement[];
    viewport?: Viewport;
    theme?: PlaitTheme;
    initialLanguage?: 'zh' | 'en';
    tutorial?: boolean;
    onValueChange?: (elements: PlaitElement[]) => void;
    onViewportChange?: (viewport: Viewport) => void;
    onThemeChange?: (mode: ThemeColorMode) => void;
  }>;
}
