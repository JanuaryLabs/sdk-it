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

import { MD } from '../api-doc/md';
import {
  Credenza,
  CredenzaBody,
  CredenzaContent,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaTrigger,
} from '../components/credenza';
import { MessageInput } from '../hooks/message-input';
import { useScrollToBottom } from '../hooks/use-scroll-to-bottom';
import { Button } from '../shadcn';
import { cn } from '../shadcn/cn';
import { TextShimmer } from './text-shimmer';

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
  const [storedMessages, setStoredMessages] = useLocalStorage<Message[]>(
    'messages',
    [],
  );
  const {
    messages,
    input,
    setInput,
    append,
    addToolResult,
    handleInputChange,
    handleSubmit,
    status,
    isLoading,
    stop,
  } = useChat({
    api: 'http://localhost:3000',
    // initialMessages: storedMessages,
  });

  return (
    <div
      className={cn(
        'prose-sm prose-p:my-1 prose-ol:my-1 mx-auto w-full py-4 text-sm',
        props.className,
      )}
    >
      <div className="relative flex flex-col overflow-auto">
        <div className="flex h-full flex-col items-start">
          <ChatList status={status} messages={messages} append={append} />
        </div>
      </div>
      {/* <Separator /> */}
      {/* <PromptForm
        handleInputChange={handleInputChange}
        handleSubmit={handleSubmit}
        input={input}
        status={status}
        stop={stop}
      /> */}
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

function PromptForm(props: {
  handleSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  input: string;
  status: UseChatHelpers['status'];
  stop: UseChatHelpers['stop'];
}) {
  return (
    <form
      onSubmit={props.handleSubmit}
      className="flex w-full items-center justify-between"
    >
      <MessageInput
        isGenerating={false}
        value={props.input}
        submitOnEnter={true}
        stop={props.stop}
        onChange={props.handleInputChange}
      />
    </form>
    // <form
    //   onSubmit={props.handleSubmit}
    //   className="mt-auto flex w-full items-center justify-between"
    // >
    //   <Input
    //     onChange={props.handleInputChange}
    //     value={props.input}
    //     placeholder="What's your question?"
    //     className="h-14 w-full border-0 px-4 text-base shadow-none focus-visible:ring-0"
    //   />
    //   {props.status === 'submitted' ? (
    //     <Button
    //       variant={'ghost'}
    //       size={'icon'}
    //       type="button"
    //       className="mx-4"
    //       onClick={props.stop}
    //     >
    //       <svg
    //         xmlns="http://www.w3.org/2000/svg"
    //         fill="none"
    //         viewBox="0 0 24 24"
    //         strokeWidth={1.5}
    //         stroke="currentColor"
    //         className="size-6"
    //       >
    //         <path
    //           strokeLinecap="round"
    //           strokeLinejoin="round"
    //           d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
    //         />
    //         <path
    //           strokeLinecap="round"
    //           strokeLinejoin="round"
    //           d="M9 9.563C9 9.252 9.252 9 9.563 9h4.874c.311 0 .563.252.563.563v4.874c0 .311-.252.563-.563.563H9.564A.562.562 0 0 1 9 14.437V9.564Z"
    //         />
    //       </svg>
    //     </Button>
    //   ) : (
    //     <Button variant={'ghost'} size={'icon'} type="submit" className="mx-4">
    //       <svg
    //         xmlns="http://www.w3.org/2000/svg"
    //         viewBox="0 0 20 20"
    //         fill="currentColor"
    //         className="size-5"
    //       >
    //         <path
    //           fillRule="evenodd"
    //           d="M16.25 3a.75.75 0 0 0-.75.75v7.5H4.56l1.97-1.97a.75.75 0 0 0-1.06-1.06l-3.25 3.25a.75.75 0 0 0 0 1.06l3.25 3.25a.75.75 0 0 0 1.06-1.06l-1.97-1.97h11.69A.75.75 0 0 0 17 12V3.75a.75.75 0 0 0-.75-.75Z"
    //           clipRule="evenodd"
    //         />
    //       </svg>
    //     </Button>
    //   )}
    // </form>
  );
}

export function ChatList(
  props: PropsWithChildren<{
    messages: Message[];
    append: UseChatHelpers['append'];
    status: UseChatHelpers['status'];
  }>,
) {
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

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom, props.messages]);

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

  return (
    <div
      ref={messagesContainerRef}
      className="relative flex h-full min-w-0 flex-1 flex-col gap-2"
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
      {props.messages.map((message) => (
        <React.Fragment key={message.id}>
          {message.role === 'user' ? (
            <UserMessage message={message.content} />
          ) : (
            <AssistantMessage message={message} />
          )}
        </React.Fragment>
      ))}

      {isWaiting && (
        <div className="border-l pl-4 text-sm">
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
                    <div key={toolCallId} className="text-gray-500">
                      Tool call {`${toolInvocation.toolName}: `}
                      {toolInvocation.result}
                    </div>
                  )
                ) : (
                  <div key={toolCallId} className="text-gray-500">
                    Calling {toolInvocation.toolName}...
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
        <MD content={props.message.content} id={props.message.id} />
      </div>
    </div>
  );
}

export function UserMessage({ message }: { message: string }) {
  return (
    <div className="bg-background sticky top-0 z-10 block py-4 text-sm font-semibold text-[#204300]">
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
