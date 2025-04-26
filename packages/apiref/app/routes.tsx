import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  // route('*?', './app.tsx', { id: 'app' }),
  index('./app.tsx', { id: 'app-root' }), // exact "/"
  route('*', './app.tsx'),
] satisfies RouteConfig;
