import { LayoutGroup, motion } from 'framer-motion';

import { TextRotate } from './text-rotate';

export function Title() {
  return (
    <div className="flex flex-col justify-center items-center w-full z-50 pointer-events-auto">
      {/* <motion.h1
        className="text-3xl font-bold lg:text-5xl text-center w-full flex whitespace-pre leading-tight tracking-tight space-y-1"
        animate={{ opacity: 1, y: 0 }}
        initial={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.2, ease: 'easeIn', delay: 0.3 }}
      >
        <span>Generate SDK for</span>
        <LayoutGroup>
          <motion.span layout className="flex whitespace-pre">
            <TextRotate
              texts={[' Developers', ' LLM']}
              mainClassName="overflow-hidden pr-3 text-[#0015ff] rounded-xl"
              staggerDuration={0.03}
              staggerFrom="last"
              rotationInterval={3000}
              transition={{ type: 'spring', damping: 30, stiffness: 400 }}
            />
          </motion.span>
        </LayoutGroup>
      </motion.h1> */}
     
    </div>
  );
}
