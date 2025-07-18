import { cn } from '@sdk-it/shadcn';

import { Logo } from './logo';

interface FooterProps {
  className?: string;
}

const Footer = ({ className }: FooterProps) => {
  return (
    <footer
      className={cn(
        'bg-background text-muted-foreground flex flex-col items-center text-xs sm:text-sm',
        className,
      )}
    >
      <div className="flex w-full flex-col items-start justify-between sm:flex-row">
        <div className="pt-12 pb-8 sm:py-16">
          <Logo />
          <p className="text-muted-foreground mt-4 leading-relaxed">
            Made with care by{' '}
            <a
              className="text-primary font-semibold transition-colors hover:underline"
              href="https://overengineering.studio"
            >
              JanuaryLabs
            </a>{' '}
            &amp; contributors
            <br />© 2025{' '}
          </p>
        </div>
        <div className="flex items-start gap-8 pb-8 sm:py-16">
          <div>
            <h3 className="text-primary text-xs font-semibold tracking-wider uppercase">
              Resources
            </h3>
            <ul className="text-muted-foreground mt-3 leading-relaxed">
              <li>
                <a
                  href="https://docs.livestore.dev/"
                  className="text-muted-foreground hover:text-primary transition-colors hover:underline"
                >
                  Docs
                </a>
              </li>
              <li>
                <a
                  href="https://docs.livestore.dev/examples"
                  className="text-muted-foreground hover:text-primary transition-colors hover:underline"
                >
                  Examples
                </a>
              </li>
              <li>
                <a
                  href="https://docs.livestore.dev/reference/devtools"
                  className="text-muted-foreground hover:text-primary transition-colors hover:underline"
                >
                  Devtools
                </a>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-primary text-xs font-semibold tracking-wider uppercase">
              Community
            </h3>
            <div className="mt-3.5 flex gap-2">
              <a
                href="https://github.com/livestorejs/livestore"
                className="text-muted-foreground hover:text-primary transition-colors"
                aria-label="GitHub"
              >
                <span className="sr-only">Github</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 496 512"
                  className="size-5 fill-current"
                >
                  <path d="M165.9 397.4c0 2-2.3 3.6-5.2 3.6-3.3 .3-5.6-1.3-5.6-3.6 0-2 2.3-3.6 5.2-3.6 3-.3 5.6 1.3 5.6 3.6zm-31.1-4.5c-.7 2 1.3 4.3 4.3 4.9 2.6 1 5.6 0 6.2-2s-1.3-4.3-4.3-5.2c-2.6-.7-5.5 .3-6.2 2.3zm44.2-1.7c-2.9 .7-4.9 2.6-4.6 4.9 .3 2 2.9 3.3 5.9 2.6 2.9-.7 4.9-2.6 4.6-4.6-.3-1.9-3-3.2-5.9-2.9zM244.8 8C106.1 8 0 113.3 0 252c0 110.9 69.8 205.8 169.5 239.2 12.8 2.3 17.3-5.6 17.3-12.1 0-6.2-.3-40.4-.3-61.4 0 0-70 15-84.7-29.8 0 0-11.4-29.1-27.8-36.6 0 0-22.9-15.7 1.6-15.4 0 0 24.9 2 38.6 25.8 21.9 38.6 58.6 27.5 72.9 20.9 2.3-16 8.8-27.1 16-33.7-55.9-6.2-112.3-14.3-112.3-110.5 0-27.5 7.6-41.3 23.6-58.9-2.6-6.5-11.1-33.3 2.6-67.9 20.9-6.5 69 27 69 27 20-5.6 41.5-8.5 62.8-8.5s42.8 2.9 62.8 8.5c0 0 48.1-33.6 69-27 13.7 34.7 5.2 61.4 2.6 67.9 16 17.7 25.8 31.5 25.8 58.9 0 96.5-58.9 104.2-114.8 110.5 9.2 7.9 17 22.9 17 46.4 0 33.7-.3 75.4-.3 83.6 0 6.5 4.6 14.4 17.3 12.1C428.2 457.8 496 362.9 496 252 496 113.3 383.5 8 244.8 8zM97.2 352.9c-1.3 1-1 3.3 .7 5.2 1.6 1.6 3.9 2.3 5.2 1 1.3-1 1-3.3-.7-5.2-1.6-1.6-3.9-2.3-5.2-1zm-10.8-8.1c-.7 1.3 .3 2.9 2.3 3.9 1.6 1 3.6 .7 4.3-.7 .7-1.3-.3-2.9-2.3-3.9-2-.6-3.6-.3-4.3 .7zm32.4 35.6c-1.6 1.3-1 4.3 1.3 6.2 2.3 2.3 5.2 2.6 6.5 1 1.3-1.3 .7-4.3-1.3-6.2-2.2-2.3-5.2-2.6-6.5-1zm-11.4-14.7c-1.6 1-1.6 3.6 0 5.9 1.6 2.3 4.3 3.3 5.6 2.3 1.6-1.3 1.6-3.9 0-6.2-1.4-2.3-4-3.3-5.6-2z" />
                </svg>
              </a>
              <a
                href="https://discord.gg/RbMcjUAPd7"
                className="text-muted-foreground hover:text-primary transition-colors"
                aria-label="Discord"
              >
                <span className="sr-only">Discord</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 640 512"
                  className="size-5 fill-current"
                >
                  <path d="M524.5 69.8a1.5 1.5 0 0 0 -.8-.7A485.1 485.1 0 0 0 404.1 32a1.8 1.8 0 0 0 -1.9 .9 337.5 337.5 0 0 0 -14.9 30.6 447.8 447.8 0 0 0 -134.4 0 309.5 309.5 0 0 0 -15.1-30.6 1.9 1.9 0 0 0 -1.9-.9A483.7 483.7 0 0 0 116.1 69.1a1.7 1.7 0 0 0 -.8 .7C39.1 183.7 18.2 294.7 28.4 404.4a2 2 0 0 0 .8 1.4A487.7 487.7 0 0 0 176 479.9a1.9 1.9 0 0 0 2.1-.7A348.2 348.2 0 0 0 208.1 430.4a1.9 1.9 0 0 0 -1-2.6 321.2 321.2 0 0 1 -45.9-21.9 1.9 1.9 0 0 1 -.2-3.1c3.1-2.3 6.2-4.7 9.1-7.1a1.8 1.8 0 0 1 1.9-.3c96.2 43.9 200.4 43.9 295.5 0a1.8 1.8 0 0 1 1.9 .2c2.9 2.4 6 4.9 9.1 7.2a1.9 1.9 0 0 1 -.2 3.1 301.4 301.4 0 0 1 -45.9 21.8 1.9 1.9 0 0 0 -1 2.6 391.1 391.1 0 0 0 30 48.8 1.9 1.9 0 0 0 2.1 .7A486 486 0 0 0 610.7 405.7a1.9 1.9 0 0 0 .8-1.4C623.7 277.6 590.9 167.5 524.5 69.8zM222.5 337.6c-29 0-52.8-26.6-52.8-59.2S193.1 219.1 222.5 219.1c29.7 0 53.3 26.8 52.8 59.2C275.3 311 251.9 337.6 222.5 337.6zm195.4 0c-29 0-52.8-26.6-52.8-59.2S388.4 219.1 417.9 219.1c29.7 0 53.3 26.8 52.8 59.2C470.7 311 447.5 337.6 417.9 337.6z" />
                </svg>
              </a>
              <a
                href="https://bsky.app/profile/livestore.dev"
                className="text-muted-foreground hover:text-primary transition-colors"
                aria-label="Bluesky"
              >
                <span className="sr-only">Bluesky</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 576 512"
                  className="size-5 fill-current"
                >
                  <path d="M123.6 34.5c66.4 50.1 137.9 151.5 164.2 206C314 186 385.5 84.5 452 34.5c48-36.1 125.6-64.1 125.6 24.9c0 17.8-10.1 149.2-16.1 170.5c-20.7 74.2-96.1 93.1-163.1 81.6c117.2 20 147 86.3 82.6 152.6C358.7 590 305.2 432.5 291.5 392.1c-2.5-7.5-3.7-10.9-3.7-7.9c0-3.1-1.2 .4-3.7 7.9C270.4 432.5 216.9 590 94.6 464.1C30.2 397.8 60 331.5 177.2 311.5C110.2 322.9 34.8 304 14.1 229.8C8.1 208.5-2 77.1-2 59.3c0-88.9 77.7-61 125.6-24.9z" />
                </svg>
              </a>
              <a
                href="https://x.com/livestoredev"
                className="text-muted-foreground hover:text-primary transition-colors"
                aria-label="Twitter"
              >
                <span className="sr-only">Twitter</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 512 512"
                  className="size-5 fill-current"
                >
                  <path d="M389.2 48h70.6L305.6 224.2 487 464H345L233.7 318.6 106.5 464H35.8L200.7 275.5 26.8 48H172.4L272.9 180.9 389.2 48zM364.4 421.8h39.1L151.1 88h-42L364.4 421.8z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export { Footer };
