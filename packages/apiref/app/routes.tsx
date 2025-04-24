import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
  index('./app.tsx', { id: 'app' }),
  route('/*', './app.tsx', { id: 'wild' }),
] satisfies RouteConfig;
