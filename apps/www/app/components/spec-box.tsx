import { Paperclip } from 'lucide-react';
import { useCallback, useState } from 'react';
import { type FileRejection, useDropzone } from 'react-dropzone';
import { toast } from 'sonner';

import { Button, CardDescription, cn } from '../shadcn';
import { Loader } from './loading-text';

export default function SpecBox(props: {
  className?: string;
  projectId?: number;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  function generate() {
    toast.promise(
      async () => {
        await new Promise((resolve) => {
          setTimeout(() => {
            resolve(true);
            setLoading(false);
          }, 2000);
        });
      },
      {
        loading: 'Generating...',
        success: 'Files uploaded successfully',
        error: 'Failed to upload files',
        duration: 2000,
      },
    );
    setLoading(true);
  }

  const onDrop = useCallback(
    async (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      setFile(acceptedFiles[0]);

      if (fileRejections.length > 0) {
        fileRejections.forEach(({ file }) => {
          toast.error(`File ${file.name} is not supported`);
        });
      }
    },
    [],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    multiple: false,
    maxFiles: 1,
    disabled: loading,
    maxSize: 10 * 1024 * 1024, // 10 MB
    autoFocus: true,
    noClick: true, // Disable opening the file dialog on click of the dropzone area
    // validator: (file) => {
    //   if (file.size > 10 * 1024 * 1024) {
    //     return {
    //       code: 'file-too-large',
    //       message: `File ${file.name} is too large. Maximum size is 10MB.`,
    //     };
    //   }
    //   if (!['application/json', 'application/yaml'].includes(file.type)) {
    //     return {
    //       code: 'file-type-not-supported',
    //       message: `File ${file.name} is not supported. Only JSON and YAML files are allowed.`,
    //     };
    //   }
    //   return null;
    // },
    accept: {
      'application/json': ['.json'],
      'application/yaml': ['.yaml', '.yml'],
    },
  });

  return (
    <div
      {...getRootProps()} // Apply dropzone props to the whole component
      className={cn(
        props.className,
        'relative overflow-hidden rounded-2xl border border-neutral-500 shadow-lg',
        isDragActive
          ? 'border-blue-500 bg-blue-50'
          : !loading &&
              'border-neutral-200 bg-gray-50 hover:border-gray-400 focus:border-gray-400 focus-visible:border-gray-400 focus-within:border-gray-400',
      )}
    >
      <textarea
        disabled={loading}
        placeholder="Enter OpenAPI spec url, upload file, or paste the spec here..."
        rows={3}
        className="bg-white w-full focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50  resize-none px-6 py-4 text-lg text-neutral-n11 placeholder-neutral-n7 focus:outline-none"
        defaultValue={''}
        onClick={(e) => e.stopPropagation()} // Prevent dropzone click handler on textarea
			/>
			<div className=' p-3 pt-1'>

      <div className="mb-2 text-muted-foreground text-xs">
        This is a playground where you can test SDK-IT features.
      </div>
      <div className="flex w-full items-center justify-between">
        <div>
          <Button
            disabled={loading}
            variant={'outline'}
            size={'sm'}
            className="shadow-none"
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
          onClick={generate}
          disabled={loading}
          variant={'secondary'}
          className="border"
        >
          {loading ? (
            <Loader size="lg" text="Generating" variant={'loading-dots'} />
          ) : (
            'Generate now'
          )}
        </Button>
      </div>
			</div>
    </div>
  );
}
