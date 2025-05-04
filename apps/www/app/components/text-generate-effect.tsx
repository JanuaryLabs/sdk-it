import { motion, stagger, useAnimate } from 'framer-motion';
import { useEffect } from 'react';

import { cn } from '../shadcn';

export const TextGenerateEffect = ({
  words,
  className,
  filter = true,
  duration = 0.5,
  wordClassMap,
}: {
  words: string;
  className?: string;
  filter?: boolean;
  duration?: number;
  wordClassMap?: Record<string, string>;
}) => {
  const [scope, animate] = useAnimate();
  const wordsArray = words.split(' ');
  useEffect(() => {
    animate(
      'span',
      {
        opacity: 1,
        filter: filter ? 'blur(0px)' : 'none',
      },
      {
        duration: duration ? duration : 1,
        delay: stagger(0.2),
      },
    );
  }, [scope.current]);

  const renderWords = () => {
    return (
      <motion.div ref={scope}>
        {wordsArray.map((word, idx) => {
          return (
            <motion.span
              key={word + idx}
              className={cn(
                'text-foreground/80 opacity-0 dark:text-white',
                wordClassMap && wordClassMap[word],
              )}
              style={{
                filter: filter ? 'blur(10px)' : 'none',
              }}
            >
              {word}{' '}
            </motion.span>
          );
        })}
      </motion.div>
    );
  };

  return (
    <div className={cn('text-black dark:text-white', className)}>
      {renderWords()}
    </div>
  );
};
