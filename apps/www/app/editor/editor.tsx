import MonacoEditor, { useMonaco } from '@monaco-editor/react';
import type monaco from 'monaco-editor';
import { useRef } from 'react';

import { cn } from '../shadcn';
import { EditorContext, EditorLayout } from './editor-layout';
import { useEditorFormatter } from './use-editor-formatter';
import { useTheme } from './use-editor-theme';

// export const monaco$ = from(loader.init()).pipe(take(1));

// export const editor$ = monaco$.pipe(
//   switchMap((monaco) => {
//     return new Observable<{
//       editor: monaco.editor.ICodeEditor;
//       monaco: typeof import('monaco-editor');
//     }>((observer) => {
//       const disposable = monaco.editor.onDidCreateEditor((editor) => {
//         observer.next({ editor, monaco });
//       });
//       return () => disposable.dispose();
//     });
//   }),
// );
// export const model$ = monaco$.pipe(
//   switchMap((monaco) => {
//     return new Observable<{
//       model: monaco.editor.ITextModel;
//       monaco: typeof import('monaco-editor');
//     }>((observer) => {
//       const disposable = monaco.editor.onDidCreateModel((model) => {
//         observer.next({ model, monaco });
//       });
//       return () => disposable.dispose();
//     });
//   }),
// );

export function Editor(props: {
  className?: string;
  onEditor?: (
    editor: monaco.editor.IStandaloneCodeEditor,
    monaco: typeof import('monaco-editor'),
  ) => void;
  onChange?: (
    value: string,
    event: monaco.editor.IModelContentChangedEvent,
    editor: monaco.editor.IStandaloneCodeEditor,
    model: monaco.editor.ITextModel,
    markers: monaco.editor.IMarker[],
  ) => void;
  value?: string;
  language?: string;
  path?: string;
  readonly?: boolean;
  printWidth?: number;
  tabSize?: number;
  declarations?: { text: string; filename: string }[];
}) {
  useTheme('lighter');
  useEditorFormatter();

  const monaco = useMonaco();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  return (
    <EditorContext.Provider value={editorRef.current}>
      <EditorLayout>
        <MonacoEditor
          onMount={async (editor, monaco) => {
            editorRef.current = editor;
            props.onEditor?.(editor, monaco);
          }}
          beforeMount={async (monaco) => {
            monaco.editor.addKeybindingRule({
              keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space,
              command: 'editor.action.triggerSuggest',
            });

            (props.declarations ?? []).forEach((declaration) => {
              monaco.languages.typescript.typescriptDefaults.addExtraLib(
                declaration.text
                  .replace('export {}', '')
                  .replaceAll('export ', ''),
                declaration.filename,
              );
              monaco.languages.typescript.typescriptDefaults.setCompilerOptions(
                {
                  noUnusedLocals: false,
                  noUnusedParameters: false,
                  allowNonTsExtensions: true,
                  allowSyntheticDefaultImports: true,
                  allowUnreachableCode: true,
                  allowUnusedLabels: true,
                  target: monaco.languages.typescript.ScriptTarget.ESNext,
                  moduleResolution:
                    monaco.languages.typescript.ModuleResolutionKind.NodeJs,
                  skipDefaultLibCheck: true,
                  skipLibCheck: true,
                  module: monaco.languages.typescript.ModuleKind.ESNext,
                  baseUrl: '.',
                  typeRoots: [
                    'file:///node_modules',
                    'file:///node_modules/@types',
                    'node_modules/@types',
                    'node_modules',
                  ],
                },
              );
              monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(
                {
                  onlyVisible: true,
                  diagnosticCodesToIgnore: [
                    7044, // "Parameter '' implicitly has an 'any' type, but a better type may be inferred from usage."
                    6133, // variable is declared but never used
                    6138, // property is declared but its value is never read
                  ],
                },
              );
            });
          }}
          theme="lighter"
          width="100%"
          height="100%"
          className={cn('w-full h-full', props.className, 'code-editor')}
          defaultLanguage="typescript"
          language={props.language ?? 'typescript'}
          loading=" "
          path={props.path}
          onChange={(value, event) => {
            if (!value) return;
            if (!monaco) return;
            const editor = editorRef.current;
            if (!editor) return;
            const model = editor.getModel();
            if (!model) return;

            const markers = monaco.editor.getModelMarkers({
              owner: 'typescript',
              resource: model.uri,
            });
            props.onChange?.(value, event, editor, model, markers);
          }}
          value={props.value}
          options={{
            fontFamily: 'var(--font-mono)',
            cursorSmoothCaretAnimation: 'explicit',
            readOnly: props.readonly,
            domReadOnly: props.readonly,
            lineNumbersMinChars: 3,
            lineDecorationsWidth: 4,
            fontSize: 14,
            minimap: {
              enabled: false,
            },
            smoothScrolling: true,
            trimAutoWhitespace: true,
            wordWrap: 'bounded',
            wrappingStrategy: 'advanced',
            wrappingIndent: 'same',
            wordWrapColumn: props.printWidth ?? 80,
            tabSize: props.tabSize ?? 2,
            autoIndent: 'full',
            formatOnPaste: true,
            formatOnType: true,
            autoClosingBrackets: 'always',
            autoClosingQuotes: 'always',
            autoClosingComments: 'always',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            readOnlyMessage: { value: 'Read Only' },
            scrollbar: {
              vertical: 'hidden',
              horizontal: 'hidden',
            },
            overviewRulerBorder: false,
            inlayHints: {
              enabled: 'on',
              fontSize: 10,
            },
          }}
        />
      </EditorLayout>
    </EditorContext.Provider>
  );
}
