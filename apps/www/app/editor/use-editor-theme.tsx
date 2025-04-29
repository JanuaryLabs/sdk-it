import { useMonaco } from '@monaco-editor/react';
import type monaco from 'monaco-editor';
import { useEffect } from 'react';

export function useTheme(theme: 'lighter' | 'darker') {
  const monaco = useMonaco();
  useEffect(() => {
    if (monaco) {
      (async () => {
        monaco.editor.defineTheme(
          'lighter',
          // theme,
          (await import(
            'monaco-themes/themes/IDLE.json'
          )) as monaco.editor.IStandaloneThemeData,
        );
        monaco.editor.defineTheme(
          'darker',
          // theme,
          (await import(
            'monaco-themes/themes/GitHub Dark.json'
          )) as monaco.editor.IStandaloneThemeData,
        );
        monaco.editor.setTheme(theme);
      })();
    }
  }, [monaco, theme]);
}
