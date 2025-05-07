import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('./app.tsx', { id: 'app-root' }), // exact "/"
  route('embed', './embed.tsx', { id: 'embed' }), // /embed
  route('/:group/:operationId', './app.tsx', {
    id: 'operation',
  }),
  route('*', './app.tsx', {
    id: 'catch-all',
  }), // catch all
] satisfies RouteConfig;
