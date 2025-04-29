import type monaco from 'monaco-editor';
import { lazy } from 'react';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));

// https://farzadyz.com/blog/single-line-monaco-editor
const monacoOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
  renderLineHighlight: 'none',
  quickSuggestions: false,
  glyphMargin: false,
  lineDecorationsWidth: 0,
  folding: false,
  fixedOverflowWidgets: true,
  acceptSuggestionOnEnter: 'on',
  hover: {
    delay: 100,
  },
  roundedSelection: false,
  contextmenu: false,
  cursorStyle: 'line-thin',
  occurrencesHighlight: 'off',
  links: false,
  minimap: { enabled: false },
  // see: https://github.com/microsoft/monaco-editor/issues/1746
  wordBasedSuggestions: 'off',
  // disable `Find`
  find: {
    addExtraSpaceOnTop: false,
    autoFindInSelection: 'never',
    seedSearchStringFromSelection: 'never',
  },
  fontSize: 14,
  fontWeight: 'normal',
  wordWrap: 'off',
  lineNumbers: 'off',
  lineNumbersMinChars: 0,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  scrollBeyondLastColumn: 0,
  scrollbar: {
    horizontal: 'hidden',
    vertical: 'hidden',
    // avoid can not scroll page when hover monaco
    alwaysConsumeMouseWheel: false,
  },
};

export function SingleLineEditor() {
  const handleSubmit = async () => {
    //
  };

  return (
    <div className="flex justify-center items-start h-screen">
      <MonacoEditor
        width="100%"
        language="typescript"
        loading=" "
        options={monacoOptions}
        height="100%"
        defaultLanguage="javascript"
        defaultValue='Deno.serve(req => new Response("Hello!"));'
      />
    </div>
  );
}
