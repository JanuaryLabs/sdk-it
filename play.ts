import { ParseError, Serverize } from '@serverize/client';

const serverize = new Serverize({
  baseUrl: 'http://localhost:3000',
});

const [result, error] = await serverize.request(
  'POST /operations/releases/start',
  {
    channel: 'dev',
    projectId: '600adc42-81b1-4337-8f93-205d81f081f9',
    projectName: 'vscode',
    releaseName: 'apiref',
    image: 'openstatus/apiref:latest',
    runtimeConfig: '{}',
    tarLocation: '',
  },
);

if (error) {
  if (error instanceof ParseError) {
    console.dir(error.data, { depth: 10 });
  } else {
    console.error(error);
  }
} else {
  console.log(result);
}
