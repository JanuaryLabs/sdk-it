import { Paperclip } from 'lucide-react';
import { useCallback, useState } from 'react';
import { type FileRejection, useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { useLocalStorage } from 'usehooks-ts';
import { z } from 'zod';

import { type PostPlayground, SdkIt } from '@sdk-it/client';
import { Button, cn } from '@sdk-it/shadcn';

import { Loader } from './loading-text';

const client = new SdkIt({
  baseUrl: 'http://localhost:3000',
});

// async function toSdks(file: File) {
//   const result = await client.request('POST /generate', {
//     specFile: file,
//   });
//   const decoder = new TextDecoder('utf-8');
//   const chunks = await Array.fromAsync(result);

//   let fullText = '';
//   for (const chunk of chunks) {
//     fullText += decoder.decode(chunk, { stream: true });
//   }
//   fullText += decoder.decode();
//   const lines = fullText.split('\n');

//   return lines
//     .map((line) => line.trim())
//     .filter((line) => line)
//     .map((l) => {
//       try {
//         return JSON.parse(l);
//       } catch (e) {
//         console.log('Failed to parse JSON line:', l);
//         console.error(e);
//         return null; // Return null for lines that fail to parse
//       }
//     })
//     .filter((obj) => obj !== null); // Filter out nulls (failed parses)
// }

export default function SpecBox({
  onGenerate,
  ...props
}: {
  className?: string;
  projectId?: number;
  onGenerate: (sdkInfo: PostPlayground) => void;
}) {
  const [boxValue, setBoxValue] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useLocalStorage<any[]>('ts-sdk', [], {
    initializeWithValue: false,
  });
  const [sdkInfo, setSdkInfo] = useLocalStorage<PostPlayground | null>(
    'ts-sdk-info',
    null,
    {
      initializeWithValue: false,
    },
  );
  const generate = useCallback(async () => {
    setLoading(true);
    let specFile = file;
    if (!specFile && !boxValue) {
      toast.error(
        'Please upload a OpenAPI/Swagger file, paste content or enter a URL.',
      );
      setLoading(false);
      return;
    }
    if (!specFile) {
      if (z.string().url().safeParse(boxValue)) {
        const spec = await client.request('GET /fetch', {
          url: boxValue,
        });
        if (!spec) {
          toast.error('Invalid OpenAPI spec.', {
            description: 'Please enter a valid OpenAPI/Swagger spec URL.',
          });
          setLoading(false);
          return;
        }
        specFile = new File([JSON.stringify(spec)], 'spec.json', {
          type: 'application/json',
        });
      } else {
        toast.error('Invalid URL.', {
          description: 'Please enter a valid OpenAPI/Swagger spec URL.',
        });
        setLoading(false);
        return;
      }
    }

    toast.promise(
      async () => {
        try {
          const result = await client.request('POST /playground', {
            specFile,
          });

          setSdkInfo(result);
          onGenerate(result);

          // setContent(await toSdks(specFile));
        } catch (error) {
          console.error(error);
          throw error;
        } finally {
          setLoading(false);
        }
      },
      {
        loading: 'Generating...',
        success: 'Files uploaded successfully',
        error: 'Failed to upload files',
        duration: 5000,
      },
    );
  }, [file, setSdkInfo, onGenerate, boxValue]);

  const onDrop = useCallback(
    async (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      if (fileRejections.length > 0) {
        fileRejections.forEach(({ file }) => {
          toast.error(`File ${file.name} is not supported`);
        });
      } else {
        setFile(acceptedFiles[0]);
        generate();
      }
    },
    [generate],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: false,
    maxFiles: 1,
    disabled: loading,
    maxSize: 10 * 1024 * 1024, // 10 MB
    autoFocus: true,
    noClick: true, // Disable opening the file dialog on click of the dropzone area
    validator: (file) => {
      if (file.size > 10 * 1024 * 1024) {
        return {
          code: 'file-too-large',
          message: `File ${file.name} is too large. Maximum size is 1MB.`,
        };
      }
      if (!['application/json', 'application/yaml'].includes(file.type)) {
        return {
          code: 'file-type-not-supported',
          message: `File ${file.name} is not supported. Only JSON and YAML files are allowed.`,
        };
      }
      return null;
    },
    accept: {
      'application/json': ['.json'],
      'application/yaml': ['.yaml', '.yml'],
    },
  });

  return (
    <form
      {...getRootProps()} // Apply dropzone props to the whole component
      className={cn(
        props.className,
        'relative overflow-hidden rounded-lg border bg-white/5',
        isDragActive
          ? 'border-blue-500 bg-blue-50'
          : !loading &&
              'focus-within:border-neutral-700 hover:border-neutral-700 focus:border-neutral-700 focus-visible:border-neutral-700',
      )}
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <textarea
        disabled={loading}
        placeholder="Enter OpenAPI spec url, upload file, or paste the spec here..."
        rows={3}
        className="w-full resize-none px-6 py-4 text-lg focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        value={boxValue}
        onChange={(e) => {
          setBoxValue(e.target.value);
        }}
        onClick={(e) => {
          e.stopPropagation();
        }} // Prevent dropzone click handler on textarea
      />
      <div className="p-3 pt-1">
        <div className="text-muted-foreground mb-2 text-xs">
          This is a playground where you can test SDK-IT features.
        </div>
        <div className="flex w-full items-center justify-between">
          <div>
            <Button
              disabled={loading}
              variant={'secondary'}
              size={'sm'}
              className="shadow-none"
              type="button"
              onClick={(e) => {
                e.stopPropagation(); // Prevent event bubbling to parent dropzone
                open(); // Manually open the file dialog
              }}
            >
              <Paperclip />
              <input {...getInputProps()} />
            </Button>
          </div>
          <Button
            onClick={async () => {
              generate();
              // const result = await client.request('POST /playground', {
              //   specFile: new File(['{}'], 'spec.json', {
              //     type: 'application/json',
              //   }),
              // });
              // onGenerate(result);
            }}
            disabled={loading}
            variant={'outline'}
            className="border shadow-none"
            type="submit"
          >
            {loading ? (
              <Loader size="lg" text="Generating" variant={'loading-dots'} />
            ) : (
              'Generate now'
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
