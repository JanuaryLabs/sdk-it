import { createCodePlugin } from '@streamdown/code';
import { Streamdown, type PluginConfig } from 'streamdown';

const staticPlugins: PluginConfig = {
  code: createCodePlugin({ themes: ['min-light', 'vesper'] }),
};

const streamingPlugins: PluginConfig = {
  code: createCodePlugin({ themes: ['min-light', 'min-dark'] }),
};

export function MD({
  content,
  className,
}: {
  content?: string;
  className?: string;
}) {
  if (!content) return null;
  return (
    <Streamdown mode="static" plugins={staticPlugins} className={className}>
      {content}
    </Streamdown>
  );
}

export function StillMarkdown({
  content,
  className,
  isAnimating,
}: {
  content?: string;
  className?: string;
  isAnimating?: boolean;
}) {
  if (!content) return null;
  return (
    <Streamdown
      plugins={streamingPlugins}
      className={className}
      isAnimating={isAnimating}
      caret={isAnimating ? 'block' : undefined}
    >
      {content}
    </Streamdown>
  );
}
