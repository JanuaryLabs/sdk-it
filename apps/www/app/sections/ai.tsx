import { type UseChatHelpers, useChat } from '@ai-sdk/react';
import type { Message } from 'ai/react';
import { Dot } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import React, {
  type PropsWithChildren,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AiOutlineArrowDown } from 'react-icons/ai';
import { useLocalStorage } from 'usehooks-ts';

import { Button, cn } from '@sdk-it/shadcn';

import {
  Credenza,
  CredenzaBody,
  CredenzaContent,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaTrigger,
} from '../components/credenza.tsx';
import { StillMarkdown } from '../components/md';
import { MessageInput } from '../components/message-input';
import { TextShimmer } from '../components/text-shimmer';
import useElementHeight from '../hooks/use-element-height';
import { useScrollToBottom } from '../hooks/use-scroll-to-bottom';

export function AI(
  props: PropsWithChildren<{
    open: boolean;
    spec: string;
  }>,
) {
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
          <AskAi spec={props.spec} />
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}

export function AskAi(props: { className?: string; spec: string }) {
  const [storedMessages, setStoredMessages] = useLocalStorage<Message[]>(
    'messages',
    [],
  );
  const [height, setHeight] = useState();
  const {
    messages,
    input,
    setInput,
    append,
    addToolResult,
    handleInputChange,
    handleSubmit,
    status,
    stop,
  } = useChat({
    api: `http://localhost:3000?specUrl=${props.spec}`,
    // initialMessages: storedMessages,
  });
  const [elementRef, scrollByHeight] = useElementHeight<HTMLDivElement>();

  return (
    <div
      ref={elementRef}
      className={cn(
        'prose prose-p:my-1 dark:prose-invert prose-ol:my-1 mx-auto w-full max-w-full min-w-auto pt-4 text-sm',
        props.className,
      )}
    >
      <div className="relative flex flex-col overflow-auto">
        <div className="flex h-full flex-col items-start">
          <ChatList
            scrollByHeight={scrollByHeight}
            status={status}
            messages={messages}
            append={append}
          />
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-background sticky bottom-0 -mx-4 -mb-4 flex w-auto items-center justify-between px-4 pb-4"
      >
        <MessageInput
          isGenerating={status === 'submitted' || status === 'streaming'}
          value={input}
          submitOnEnter={true}
          stop={stop}
          onChange={handleInputChange}
          className="flex"
        />
      </form>
    </div>
  );
}

export function ChatList(
  props: PropsWithChildren<{
    messages: Message[];
    append: UseChatHelpers['append'];
    status: UseChatHelpers['status'];
    scrollByHeight: number;
  }>,
) {
  const [containerHeight, setContainerHeight] = useState<number | undefined>(
    undefined,
  );
  const {
    isAtBottom,
    scrollToBottom,
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    onViewportEnter,
    onViewportLeave,
  } = useScrollToBottom();

  useEffect(() => {
    if (props.status === 'submitted') {
      scrollToBottom();
    }
  }, [props.status, scrollToBottom]);

  // move the last message to top on submit
  useEffect(() => {
    if (props.status === 'submitted' && messagesContainerRef.current) {
      const el = messagesContainerRef.current;
      const lastMessage = messagesEndRef.current;
      if (!lastMessage) {
        return;
      }
      // Calculate height based on the last message's position
      const lastMessageBottom =
        lastMessage.offsetTop + lastMessage.offsetHeight;
      const additionalSpace =
        Math.min(props.scrollByHeight, el.clientHeight) - 100;
      console.log(messagesContainerRef, props.scrollByHeight, el.clientHeight);
      const neededHeight = additionalSpace;
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
    if (!lastMessage.parts) {
      return true;
    }
    if (lastMessage.parts.length === 0) {
      return true;
    }
    const lastPart = lastMessage.parts.at(-1);
    if (!lastPart) {
      return true;
    }
    if (lastPart.type === 'step-start') {
      return true;
    }
    if (
      lastPart.type === 'tool-invocation' &&
      lastPart.toolInvocation.state !== 'result'
    ) {
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
    const lastCall = (lastMessage.parts ?? []).findLast(
      (it) => it.type === 'tool-invocation',
    );
    if (!lastCall) {
      return null;
    }
    if (lastCall.type !== 'tool-invocation') {
      return null;
    }
    return lastCall.toolInvocation.toolName;
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
            props.append({
              role: 'user',
              content: prompt,
            });
          }}
        />
      )}
      {props.messages.map((message, index) => (
        <React.Fragment key={message.id}>
          {message.role === 'user' ? (
            <UserMessage message={message.content} />
          ) : (
            <AssistantMessage message={message} />
          )}
        </React.Fragment>
      ))}

      {(isWaiting || lastCallName) && (
        <div className="flex flex-col border-l pl-4 text-sm">
          <TextShimmer className="font-mono text-sm" as="span">
            Thinking...
          </TextShimmer>
        </div>
      )}
      {/* {lastCallName && (
        <TextShimmer className="font-mono text-sm" as="span">
          {lastCallName}
        </TextShimmer>
      )} */}
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
      <motion.div
        ref={messagesEndRef}
        className="min-h-[24px] min-w-[24px] shrink-0"
        onViewportLeave={onViewportLeave}
        onViewportEnter={onViewportEnter}
      />
    </div>
  );
}

function SuggestedPrompts(props: { onSelectPrompt: (prompt: string) => void }) {
  return (
    <div className="mb-4 flex flex-col items-start">
      {/* <p className="text-secondary-foreground/70 my-4 text-sm">
        Hi! I'm an AI assistant trained on documentation, code, and other
        content. I can answer questions about{' '}
        <span className="font-bold text-foreground">SDK-IT</span>, what's on
        your mind?
      </p> */}
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
            variant={'outline'}
          >
            {it}
          </Button>
        ))}
      </ul>
    </div>
  );
}

export function AssistantMessage(props: { message: Message }) {
  return (
    <div className="border-l pl-4 text-sm">
      <div className="flex flex-col gap-1">
        {!import.meta.env.DEV &&
          props.message.parts
            ?.filter((it) => it.type !== 'step-start' && it.type !== 'text')
            .map((part) => {
              if (part.type === 'tool-invocation') {
                const toolInvocation = part.toolInvocation;
                const toolCallId = toolInvocation.toolCallId;
                return 'result' in toolInvocation ? (
                  toolInvocation.toolName === 'getOperations' ? (
                    <div key={toolCallId} className="contents"></div>
                  ) : (
                    <div key={toolCallId} className="text-muted-foreground">
                      Tool call {`${toolInvocation.toolName}: `}
                      {toolInvocation.result}
                    </div>
                  )
                ) : (
                  <div key={toolCallId} className="text-muted-foreground">
                    Calling {toolInvocation.toolName}...
                  </div>
                );
              }

              return (
                <div key={part.type} className="text-muted-foreground">
                  <b>{part.type}</b>
                  {JSON.stringify(part)}
                </div>
              );
            })}
        <StillMarkdown content={props.message.content} id={props.message.id} />
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
