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