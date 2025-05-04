/* eslint-disable @typescript-eslint/no-explicit-any */
import inquirer from 'inquirer';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

import type { Convo } from './convo';

// const response = await convo.talk(
//   'I want to create simple chatbot with history preserved using chat completion api',
// );
// const response = await convo.talk(
//   'how to list all assistants and their associated vectore stores',
// );
// const response = await convo.talk(
//   'I want to create simple chatbot with history preserved using responses api',
// );
marked.use((markedTerminal as any)());
// const response = await convo.talk('how to use monitor?');
// console.dir(response.output, { depth: 10 });

// console.log(marked.parse(response.output_text));

export async function print(convo: Convo) {
  let previousResponseId: string | null | undefined = null;
  // let currentPrompt = 'how to use monitor?';
  let currentPrompt = '';
  console.log(
    '----- Type your question or "exit" to quit -----\n',
    'You can ask about the API operations, generate code snippets, or look up schema definitions.\n',
  );
  while (true) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'question',
        message: '> ',
        default: 'correlate checks with api',
      },
    ]);

    currentPrompt = answers.question;
    const response = await convo.talk(
      [{ role: 'user', content: currentPrompt }],
      previousResponseId,
    );
    // console.dir(response.output, { depth: 10 });
    console.log(marked.parse(response.output_text));
    previousResponseId = response.id;
    console.log('\n----- Type your next question or "exit" to quit -----');

    // Check if user wants to exit
    if (
      currentPrompt.toLowerCase() === 'exit' ||
      currentPrompt.toLowerCase() === 'quit'
    ) {
      console.log('Exiting conversation...');
      break;
    }
  }
}
