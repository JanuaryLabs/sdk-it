import Background from './components/background';
import { Footer } from './components/footer';
import { Particles } from './components/particles';
import { TextGenerateEffect } from './components/text-generate-effect';
import { Demos } from './sections/demos';
import { Button, EyeCatchingButton, cn } from './shadcn';
import { SpecBoxDemo } from './spec-box-demo';

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
            className="text-4xl font-semibold text-balance"
            filter={false}
            duration={1}
            wordClassMap={{
              // developer: 'text-blue-700',
              // experience: 'text-green-700',
              // premium: 'text-green-700',
              OpenAPI: 'light:text-blue-700',
            }}
            words={'Turn your OpenAPI spec into premium developer experience'}
          />
        </h1>
        <h2 className="text-muted-foreground leading-tight text-balance sm:text-lg lg:max-w-none lg:text-left">
          Cut costs, reduce maintenance, and boost productivity with type-safe
          client libraries, documentation, and agent tools — all generated
          automatically.
        </h2>
      </div>
      <div className="col-span-full inline-flex flex-col items-center justify-center gap-4 sm:flex-row lg:col-span-3 lg:row-start-2 lg:mb-0 lg:justify-start xl:col-span-4">
        <div className="flex items-center gap-8">
          <Button size={'lg'}>
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
  return (
    <Background className="relative mx-auto px-4 pt-10 md:px-8 lg:px-8 xl:max-w-full xl:px-12 2xl:max-w-[1400px] 2xl:px-0 2xl:py-8">
      <Particles
        className="absolute inset-0"
        quantity={100}
        ease={30}
        color={'#000000'}
        refresh
      />
      <Hero />
      <div className="mt-32 w-full">
        <h2 className="mb-4 text-4xl font-semibold tracking-tight text-balance capitalize">
          Demos speak louder than words
        </h2>
        <h3 className="!text-muted-foreground mb-4 max-w-3xl text-xl leading-tight font-normal tracking-tight lg:text-left">
          Practical demonstrations of how SDK-IT transforms OpenAPI specs into
          sdks, documentation, AI Search, and more.
        </h3>
      </div>
      <Demos />
      {/* <div className="mt-32 w-full">
        <h2 className="mb-4 text-4xl font-semibold tracking-tight text-balance capitalize">
          Demos speak louder than words
        </h2>
        <h3 className="!text-muted-foreground mb-4 max-w-3xl text-xl leading-tight font-normal tracking-tight lg:text-left">
          Well crafted, type-safe SDKs tuned for the select language.
        </h3>
      </div>
      <StaticPlayground className="mt-8 rounded-lg border" frame /> */}

      <Footer className="w-full px-4" />
    </Background>
  );
}
