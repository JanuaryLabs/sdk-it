import { Code2Icon, DollarSignIcon, UsersIcon } from 'lucide-react';

import { Button, cn } from '@sdk-it/shadcn';

import Background from './components/background';
import { DottedBackground } from './components/dotted-vignette-background.tsx';
import { EyeCatchingButton } from './components/eye-catching-button.tsx';
import { Footer } from './components/footer';
import { SpecBoxDemo } from './components/spec-box-demo.tsx';
import { TextGenerateEffect } from './components/text-generate-effect';
import { useTheme } from './components/toggle-theme.tsx';
import { Clients } from './sections/clients.tsx';
import { Demos } from './sections/demos';

export function Hero(props: { className?: string }) {
  return (
    <div
      className={cn(
        'scroll-target mx-auto grid w-full snap-start grid-cols-4 items-start gap-8 lg:grid-cols-7 lg:grid-rows-[auto_auto]',
        props.className,
      )}
    >
      <div className="col-span-full flex w-full flex-col items-center justify-center justify-self-center lg:col-span-4 lg:row-span-1 lg:items-start lg:justify-self-start">
        <h1 className="mb-4 font-sans md:font-mono">
          <TextGenerateEffect
            className="text-4xl text-balance"
            filter={false}
            duration={0.7}
            wordClassMap={{
              OpenAPI: 'dark:text-emerald-200 text-emerald-400',
            }}
            words={'Turn your OpenAPI spec into premium developer experience'}
          />
        </h1>
        <p className="leading-snug text-balance sm:text-lg lg:max-w-none lg:text-left">
          Cut costs, reduce maintenance, and boost productivity with type-safe
          client libraries, documentation, and agent tools — all generated
          automatically.
        </p>
      </div>
      <div className="col-span-full inline-flex flex-col items-center justify-center gap-4 sm:flex-row lg:col-span-3 lg:row-start-2 lg:mt-4 lg:mb-0 lg:justify-start xl:col-span-4">
        <div className="flex items-center gap-8">
          <Button
            size={'lg'}
            className="light:text-foreground light:bg-emerald-400 dark:bg-emerald-200"
          >
            <a href="/">Get started</a>
          </Button>
          <EyeCatchingButton>
            <a href="https://cal.com/january-sh/30min"> Request a demo </a>
          </EyeCatchingButton>
        </div>
      </div>
      <div className="col-span-full flex w-full justify-center lg:col-span-full lg:col-start-5 lg:row-span-full lg:justify-end lg:justify-self-start xl:col-span-3 xl:col-start-5">
        <SpecBoxDemo />
      </div>
    </div>
  );
}

export default function App() {
  const { isDark } = useTheme();
  const showClient = false;

  return (
    <>
      {/* calc(100vh-66px-128px) = viewport - client section height - margin top */}
      <section className="content mx-auto !h-[calc(100vh-(66px+20px)-(128px/2))]">
        <Background className="relative mx-auto h-full xl:max-w-full">
          <Hero />
          <div className="flex size-full items-center justify-between">
            <div className="min-w-2/5 space-y-4">
              <div className="flex items-center gap-2">
                <Code2Icon className="text-primary h-5 w-5" />
                <p className="!text-primary font-rubik">
                  Generate robust, handcrafted SDKs instantly
                </p>
              </div>
              <div className="flex items-center gap-2">
                <DollarSignIcon className="text-primary h-5 w-5" />
                <p className="!text-primary font-rubik">
                  Reduce cost, errors, and maintenance
                </p>
              </div>
              <div className="flex items-center gap-2">
                <UsersIcon className="text-primary h-5 w-5" />
                <p className="!text-primary font-rubik">
                  Reach more users & tap into new markets
                </p>
              </div>
            </div>
            <div className="absolute -right-1/4 -bottom-1/2 h-full w-1/2 flex-1 overflow-hidden">
              {/* Top gradient overlay for blending */}
              <div className="from-background absolute top-0 right-0 left-0 z-10 h-96 bg-gradient-to-b to-transparent"></div>

              {isDark && (
                <DottedBackground
                  dotColor="#6ee7b7"
                  backgroundColor="#0f172a"
                  enableVignette={true}
                  vignetteColor="rgba(0,0,0,0.9)"
                  enableInnerGlow={true}
                  innerGlowColor="rgba(0,0,0,0.8)"
                  dotSize={1.5}
                  dotSpacing={10}
                />
              )}

              {/* Bottom gradient overlay for blending */}
              <div className="from-background absolute right-0 bottom-0 left-0 z-10 h-12 bg-gradient-to-t to-transparent"></div>
            </div>
          </div>
        </Background>
      </section>
      {showClient && (
        <section id="clients">
          <Clients />
        </section>
      )}
      <section className="content z-1 !mt-0">
        <div className="mb-8 w-full">
          <h2 className="mb-4 text-4xl text-balance capitalize">
            Demos speak louder than words
          </h2>
          <h3 className="!text-muted-foreground mb-4 max-w-lg text-lg leading-tight font-normal tracking-tight lg:text-left">
            Practical demonstrations of how SDK-IT transforms OpenAPI specs into
            sdks, documentation, AI Search, and more.
          </h3>
        </div>
        <Demos />
        <Footer className="w-full px-4" />
      </section>
    </>
  );
}
