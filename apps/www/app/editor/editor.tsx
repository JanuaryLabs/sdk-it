import MonacoEditor, { useMonaco } from '@monaco-editor/react';
import type monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { useReadLocalStorage } from 'usehooks-ts';

import { cn } from '../shadcn';
import { EditorContext, EditorLayout } from './editor-layout';
import { useTheme } from './use-editor-theme';

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
  // useEditorFormatter();
  const content = useReadLocalStorage<
    {
      filePath: string;
      content: string;
      language: 'typescript' | 'dart';
    }[]
  >('ts-sdk', {
    initializeWithValue: false,
  });
  const monaco = useMonaco();
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  useEffect(() => {
    return () => {
      // Cleanup function to ensure the editor is properly disposed
      if (editorRef.current) {
        // Remove any event listeners to avoid callbacks after disposal
        editorRef.current.getModel()?.dispose();
        editorRef.current.dispose();
        editorRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!monaco) return;
    if (!content) return;
    content.forEach((item) => {
      if (item.language === 'typescript' || item.filePath.endsWith('.ts')) {
        monaco.languages.typescript.typescriptDefaults.addExtraLib(
          item.content,
          `file:///${item.filePath}`,
        );
      }
    });
    const config =
      monaco.languages.typescript.typescriptDefaults.getCompilerOptions();
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      ...config,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      paths: {
        ...config.paths,
        sdk: ['file:///index.ts'],
      },
    });
    console.log(monaco.languages.typescript.typescriptDefaults.getExtraLibs());
  }, [content, monaco]);

  return (
    <EditorContext.Provider value={editorRef.current}>
      <EditorLayout>
        <MonacoEditor
          value={props.value}
          onMount={async (editor, monaco) => {
            editorRef.current = editor;
            props.onEditor?.(editor, monaco);
            editor.layout();
          }}
          beforeMount={(monaco) => {
            monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
              noUnusedLocals: false,
              noUnusedParameters: false,
              allowNonTsExtensions: true,
              allowSyntheticDefaultImports: true,
              allowImportingTsExtensions: true,
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
            });
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
            monaco.languages.register({
              id: 'dart',
              extensions: ['.dart'],
              aliases: ['Dart', 'dart'],
              mimetypes: ['application/dart'],
            });
          }}
          theme="lighter"
          width="100%"
          height="100%"
          className={cn('h-full w-full', props.className, 'code-editor')}
          defaultLanguage="typescript"
          language={props.language ?? 'typescript'}
          loading=" "
          saveViewState={true}
          onChange={(value, event) => {
            if (!value) return;
            if (!monaco) return;
            const editor = editorRef.current;
            if (!editor) return;

            const model = editor.getModel();
            if (!model || model.isDisposed()) return;

            const markers = monaco.editor.getModelMarkers({
              owner: 'typescript',
              resource: model.uri,
            });
            props.onChange?.(value, event, editor, model, markers);
          }}
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
