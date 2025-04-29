import { useMonaco } from '@monaco-editor/react';
import { useEffect } from 'react';

// import { formatCode } from '@january/playground/data';

export function useEditorFormatter() {
  const monaco = useMonaco();

  useEffect(() => {
    if (!monaco) {
      return;
    }

    // monaco.languages.registerOnTypeFormattingEditProvider('typescript', {
    //   autoFormatTriggerCharacters: [';', ')', '}'],
    //   provideOnTypeFormattingEdits: async (
    //     model,
    //     position,
    //     ch,
    //     options,
    //     token,
    //   ) => {
    //     return [
    //       {
    //         range: model.getFullModelRange(),
    //         text: await formatCode(model.getValue(), 'ts'),
    //       },
    //     ];
    //   },
    // });
    // monaco.languages.registerDocumentFormattingEditProvider('typescript', {
    //   provideDocumentFormattingEdits: async (model, options, token) => {
    //     return [
    //       {
    //         range: model.getFullModelRange(),
    //         text: await formatCode(model.getValue(), 'ts'),
    //       },
    //     ];
    //   },
    // });
    // monaco.languages.registerDocumentRangeFormattingEditProvider('typescript', {
    //   provideDocumentRangeFormattingEdits: async (
    //     model,
    //     range,
    //     options,
    //     token,
    //   ) => {
    //     return [
    //       {
    //         range: range,
    //         text: await formatCode(model.getValueInRange(range), 'ts'),
    //       },
    //     ];
    //   },
    // });
  }, [monaco]);
}
