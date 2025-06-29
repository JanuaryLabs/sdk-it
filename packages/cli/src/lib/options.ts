import { Option } from 'commander';

export const specOption = new Option(
  '-s, --spec <spec>',
  'Path to OpenAPI specification file',
);

export const outputOption = new Option(
  '-o, --output <output>',
  'Output directory for the generated SDK',
);

/**
 * Return the correct shell‐expansion syntax for an env var
 * on the current platform (cmd.exe vs POSIX).
 */
export function shellEnv(name: string): string {
  return process.platform === 'win32'
    ? `%${name}%` // Windows cmd.exe
    : `$${name}`; // POSIX shells
}

/**
 * Parse pagination configuration from CLI option value with dot notation support
 * @param incoming The pagination configuration value (e.g., "false", "true", "guess=false")
 * @returns PaginationConfig object or false
 */
export function parseDotConfig(
  incoming?: string,
): Record<string, unknown> | boolean | undefined {
  if (incoming === 'false') {
    return false;
  }

  if (incoming === 'true') {
    return true;
  }

  if (!incoming) {
    return undefined;
  }

  // Handle dot notation like "guess=false"
  const config: Record<string, unknown> = {};
  const pairs = incoming.split(',');

  for (const pair of pairs) {
    if (pair.includes('=')) {
      const [key, val] = pair.split('=', 2);
      if (val === 'true') {
        config[key] = true;
        continue;
      }
      if (val === 'false') {
        config[key] = false;
        continue;
      }
      config[key] = val; // Keep as string if not boolean
    }
  }

  return config;
}

export function parsePagination(config?: ReturnType<typeof parseDotConfig>) {
  if (config === true || config === undefined) {
    return undefined;
  }
  if (config === false) {
    return false;
  }
  return config;
}
