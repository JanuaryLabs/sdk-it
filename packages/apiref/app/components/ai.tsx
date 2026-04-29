import { type UIMessage, type UseChatHelpers, useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
} from 'ai';
import { Dot } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import React, {
  type ChangeEvent,
  type FormEvent,
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AiOutlineArrowDown } from 'react-icons/ai';
import { type ScrollToBottom, useStickToBottom } from 'use-stick-to-bottom';

import { Button } from '@sdk-it/shadcn';

import { StillMarkdown } from '../api-doc/markdown';
import {
  Credenza,
  CredenzaBody,
  CredenzaContent,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaTrigger,
} from '../components/credenza';
import { cn } from '../shadcn/cn';
import { MessageInput } from './message-input';
import { TextShimmer } from './text-shimmer';
import useElementHeight from './use-element-height';

type ChatHelpers = UseChatHelpers<UIMessage>;

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessage['parts'][number], { type: 'text' }> =>
      part.type === 'text',
    )
    .map((part) => part.text)
    .join('');
}

export function AI(props: PropsWithChildren<{ open: boolean }>) {
  const [open, setOpen] = useState(() => props.open);
  return (
    <Credenza open={open} onOpenChange={setOpen}>
      <CredenzaTrigger>{props.children}</CredenzaTrigger>
      <CredenzaContent className="gap-0 sm:max-w-xl xl:max-w-4xl">
        <CredenzaHeader>
          <CredenzaTitle>Ask AI</CredenzaTitle>
          <CredenzaDescription>
            Hi! I'm an AI assistant trained on documentation, code, and other
            content. I can answer questions about{' '}
            <span className="text-foreground font-bold">SDK-IT</span>, what's on
            your mind?
          </CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody>
          <AskAi />
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}

export function AskAi(props: { className?: string }) {
  const [input, setInput] = useState('');
  const transport = useMemo(
    () => new DefaultChatTransport({ api: 'http://localhost:3000' }),
    [],
  );
  const { messages, sendMessage, status, stop } = useChat({ transport });
  const [elementRef, scrollByHeight] = useElementHeight<HTMLDivElement>();
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({
    resize: 'smooth',
    initial: false,
  });

  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      elementRef(node);
      scrollRef(node);
    },
    [elementRef, scrollRef],
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    sendMessage({ text: trimmed });
    setInput('');
  };

  const handleInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };

  return (
    <div
      className={cn(
        'prose prose-p:my-1 dark:prose-invert prose-ol:my-1 mx-auto w-full max-w-full min-w-auto py-4 text-sm',
        props.className,
      )}
    >
      <div
        ref={setScrollRef}
        className="relative flex flex-col overflow-auto"
      >
        <div ref={contentRef} className="flex h-full flex-col items-start">
          <ChatList
            scrollByHeight={scrollByHeight}
            status={status}
            messages={messages}
            sendMessage={sendMessage}
            isAtBottom={isAtBottom}
            scrollToBottom={scrollToBottom}
          />
        </div>
      </div>
      <form
        onSubmit={handleSubmit}
        className="flex w-full items-center justify-between"
      >
        <MessageInput
          isGenerating={status === 'submitted' || status === 'streaming'}
          value={input}
          submitOnEnter={true}
          stop={stop}
          onChange={handleInputChange}
        />
      </form>
    </div>
  );
}

export function ChatList(
  props: PropsWithChildren<{
    messages: UIMessage[];
    sendMessage: ChatHelpers['sendMessage'];
    status: ChatHelpers['status'];
    scrollByHeight: number;
    isAtBottom: boolean;
    scrollToBottom: ScrollToBottom;
  }>,
) {
  const [containerHeight, setContainerHeight] = useState<number | undefined>(
    undefined,
  );
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { isAtBottom, scrollToBottom } = props;

  useEffect(() => {
    if (props.status === 'submitted') {
      scrollToBottom();
    }
  }, [props.status, scrollToBottom]);

  useEffect(() => {
    if (props.status === 'submitted' && messagesContainerRef.current) {
      const el = messagesContainerRef.current;
      const lastMessage = messagesEndRef.current;
      if (!lastMessage) {
        return;
      }
      const lastMessageBottom =
        lastMessage.offsetTop + lastMessage.offsetHeight;
      const additionalSpace =
        Math.min(props.scrollByHeight, el.clientHeight) - 100;
      const neededHeight = lastMessageBottom + additionalSpace;
      setContainerHeight(neededHeight);
      scrollToBottom();
    }
  }, [props.status, props.scrollByHeight, scrollToBottom]);

  const isWaiting = useMemo(() => {
    if (props.status === 'submitted') {
      return true;
    }
    const lastMessage = props.messages.at(-1);
    if (!lastMessage) {
      return false;
    }
    if (lastMessage.role === 'user') {
      return true;
    }
    if (!lastMessage.parts || lastMessage.parts.length === 0) {
      return true;
    }
    const lastPart = lastMessage.parts.at(-1);
    if (!lastPart) {
      return true;
    }
    if (lastPart.type === 'step-start') {
      return true;
    }
    if (isToolUIPart(lastPart) && lastPart.state !== 'output-available') {
      return true;
    }
    return false;
  }, [props.messages, props.status]);

  const lastCallName = useMemo(() => {
    if (props.status === 'ready') {
      return null;
    }
    const lastMessage = props.messages.at(-1);
    if (!lastMessage) {
      return null;
    }
    const lastCall = (lastMessage.parts ?? []).findLast(isToolUIPart);
    if (!lastCall) {
      return null;
    }
    return getToolName(lastCall);
  }, [props.messages, props.status]);

  return (
    <div
      ref={messagesContainerRef}
      className="relative flex min-w-0 flex-1 flex-col gap-2"
      style={{
        minHeight: containerHeight ? `${containerHeight}px` : undefined,
        transition: 'height 0.3s ease-out',
      }}
    >
      {props.messages.length === 0 && (
        <SuggestedPrompts
          onSelectPrompt={(prompt) => {
            props.sendMessage({ text: prompt });
          }}
        />
      )}
      {props.messages.map((message, index) => {
        const isLast = index === props.messages.length - 1;
        const isStreaming =
          isLast &&
          message.role === 'assistant' &&
          (props.status === 'streaming' || props.status === 'submitted');
        return (
          <React.Fragment key={message.id}>
            {message.role === 'user' ? (
              <UserMessage message={getMessageText(message)} />
            ) : (
              <AssistantMessage message={message} isStreaming={isStreaming} />
            )}
          </React.Fragment>
        );
      })}

      {(isWaiting || lastCallName) && (
        <div className="flex flex-col border-l pl-4 text-sm">
          <TextShimmer className="font-mono text-sm" as="span">
            Thinking...
          </TextShimmer>
        </div>
      )}
      <AnimatePresence>
        {!isAtBottom && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="absolute bottom-28 left-1/2 z-50 -translate-x-1/2"
          >
            <Button
              data-testid="scroll-to-bottom-button"
              className="rounded-full"
              size="icon"
              variant="outline"
              onClick={(event) => {
                event.preventDefault();
                scrollToBottom();
              }}
            >
              <AiOutlineArrowDown />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
      <div
        ref={messagesEndRef}
        className="min-h-[24px] min-w-[24px] shrink-0"
      />
    </div>
  );
}

function SuggestedPrompts(props: { onSelectPrompt: (prompt: string) => void }) {
  return (
    <div className="mb-4 flex flex-col items-start">
      <p className="text-secondary-foreground/70 mb-4 text-xs">
        Suggested Prompts
      </p>
      <ul className="flex flex-col items-start gap-y-2">
        {[
          'How to get started?',
          'How to get my info?',
          'How to create a bot?',
        ].map((it) => (
          <Button
            key={it}
            onClick={() => props.onSelectPrompt(it)}
            className="border"
            variant={'secondary'}
          >
            {it}
          </Button>
        ))}
      </ul>
    </div>
  );
}

export function AssistantMessage(props: {
  message: UIMessage;
  isStreaming?: boolean;
}) {
  const text = getMessageText(props.message);
  return (
    <div className="border-l pl-4 text-sm">
      <div className="flex flex-col gap-1">
        {!import.meta.env.DEV &&
          props.message.parts
            ?.filter((it) => it.type !== 'step-start' && it.type !== 'text')
            .map((part) => {
              if (isToolUIPart(part)) {
                const toolName = getToolName(part);
                const toolCallId = part.toolCallId;
                return part.state === 'output-available' ? (
                  toolName === 'getOperations' ? (
                    <div key={toolCallId} className="contents"></div>
                  ) : (
                    <div key={toolCallId} className="text-gray-500">
                      Tool call {`${toolName}: `}
                      {String(part.output)}
                    </div>
                  )
                ) : (
                  <div key={toolCallId} className="text-gray-500">
                    Calling {toolName}...
                  </div>
                );
              }

              return (
                <div key={part.type} className="text-gray-500">
                  <b>{part.type}</b>
                  {JSON.stringify(part)}
                </div>
              );
            })}
        <StillMarkdown content={text} isAnimating={props.isStreaming} />
      </div>
    </div>
  );
}

export function UserMessage({ message }: { message: string }) {
  return (
    <div className="bg-background text-primary dark:text-primary sticky top-0 z-10 block py-4 text-sm font-semibold">
      {message}
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="justify-left flex space-x-1">
      <div className="bg-muted rounded-lg p-3">
        <div className="flex -space-x-2.5">
          <Dot className="animate-typing-dot-bounce size-4" />
          <Dot className="animate-typing-dot-bounce size-4 [animation-delay:90ms]" />
          <Dot className="animate-typing-dot-bounce size-4 [animation-delay:180ms]" />
        </div>
      </div>
    </div>
  );
}
