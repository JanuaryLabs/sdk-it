import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUp, Square, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

import { Button } from '@sdk-it/shadcn';

import { useAutosizeTextArea } from '../hooks/use-autosize-textarea';
import { cn } from '../shadcn/cn';

interface MessageInputBaseProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  submitOnEnter?: boolean;
  stop?: () => void;
  isGenerating: boolean;
  enableInterrupt?: boolean;
}
export function MessageInput({
  placeholder = 'Ask AI...',
  className,
  onKeyDown: onKeyDownProp,
  submitOnEnter = true,
  stop,
  isGenerating,
  enableInterrupt = true,
  ...props
}: MessageInputBaseProps) {
  const [showInterruptPrompt, setShowInterruptPrompt] = useState(false);

  useEffect(() => {
    if (!isGenerating) {
      setShowInterruptPrompt(false);
    }
  }, [isGenerating]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (submitOnEnter && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();

      if (isGenerating && stop && enableInterrupt) {
        if (showInterruptPrompt) {
          stop();
          setShowInterruptPrompt(false);
          event.currentTarget.form?.requestSubmit();
        } else if (props.value) {
          setShowInterruptPrompt(true);
          return;
        }
      }

      event.currentTarget.form?.requestSubmit();
    }

    onKeyDownProp?.(event);
  };

  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useAutosizeTextArea({
    ref: textAreaRef,
    maxHeight: 240,
    borderWidth: 1,
    dependencies: [props.value],
  });

  return (
    <div className="relative flex w-full">
      {enableInterrupt && (
        <InterruptPrompt
          isOpen={showInterruptPrompt}
          close={() => setShowInterruptPrompt(false)}
        />
      )}

      <div className="relative flex w-full items-center space-x-2">
        <div className="relative flex-1">
          <textarea
            aria-label="Write your prompt here"
            placeholder={placeholder}
            ref={textAreaRef}
            onKeyDown={onKeyDown}
            className={cn(
              'border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:border-primary z-10 w-full grow resize-none rounded-xl border p-3 pr-24 text-sm transition-[border] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
            {...props}
          />
        </div>
      </div>

      <div className="absolute top-3 right-3 z-20 flex gap-2">
        {isGenerating && stop ? (
          <Button
            type="button"
            size="icon"
            className="h-8 w-8"
            aria-label="Stop generating"
            onClick={stop}
          >
            <Square className="h-3 w-3 animate-pulse" fill="currentColor" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="h-8 w-8 transition-opacity"
            aria-label="Send message"
            disabled={props.value === '' || isGenerating}
          >
            <ArrowUp className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );
}
MessageInput.displayName = 'MessageInput';

interface InterruptPromptProps {
  isOpen: boolean;
  close: () => void;
}

export function InterruptPrompt({ isOpen, close }: InterruptPromptProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ top: 0, filter: 'blur(5px)' }}
          animate={{
            top: -40,
            filter: 'blur(0px)',
            transition: {
              type: 'spring',
              filter: { type: 'tween' },
            },
          }}
          exit={{ top: 0, filter: 'blur(5px)' }}
          className="bg-background text-muted-foreground absolute left-1/2 flex -translate-x-1/2 overflow-hidden rounded-full border py-1 text-center text-sm whitespace-nowrap"
        >
          <span className="ml-2.5">Press Enter again to interrupt</span>
          <button
            className="mr-2.5 ml-1 flex items-center"
            type="button"
            onClick={close}
            aria-label="Close"
          >
            <X className="h-3 w-3" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
