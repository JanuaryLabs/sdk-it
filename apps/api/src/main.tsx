import { render } from 'ink';
import Markdown from 'ink-markdown';
import React from 'react';

const text = `
# Hello, Ink Markdown
This is rendered with **ink-markdown**.
`;

render(<Markdown>{text}</Markdown>);
