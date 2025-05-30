import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('./app.tsx'),
  route('*', './app.tsx', {
    id: 'catch-all',
  }), // catch all
] satisfies RouteConfig;
