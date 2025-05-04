import { useMonaco } from '@monaco-editor/react';
import type monaco from 'monaco-editor';
import { createContext, useContext, useEffect, useRef } from 'react';

export const EditorContext =
  createContext<monaco.editor.IStandaloneCodeEditor | null>(null);

export function EditorLayout(props: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const monaco = useMonaco();
  const editor = useContext(EditorContext);

  useEffect(() => {
    if (!monaco) return;
    if (!editor) return;
    document.fonts.ready.then(() => {
      monaco.editor.remeasureFonts();
    });

    if (ref.current) {
      const relayout = ([e]: any) => {
        editor.layout({
          width: e.borderBoxSize[0].inlineSize,
          height: e.borderBoxSize[0].blockSize,
        });
      };
      const resizeObserver = new ResizeObserver(relayout);
      resizeObserver.observe(ref.current);
    }
  }, [monaco, editor]);

  return (
    // props.children

    <div ref={ref} style={{ height: '100%', position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0 }}>{props.children}</div>
    </div>
  );
}
