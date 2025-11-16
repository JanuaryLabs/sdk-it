import { checkbox, confirm, input, select } from '@inquirer/prompts';
import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { PaginationConfig } from '@sdk-it/spec';

import type { SdkConfig, TypeScriptOptions } from '../types.ts';
import { detectMonorepo } from './find-framework.ts';
import { findSpecFile } from './find-spec-file.ts';
import { guessTypescriptPackageName } from './guess-default-package-name.ts';

const specInput = async (defaultValue?: string) => {
  return input({
    message: 'OpenAPI or Postman specification file path:',
    default: defaultValue || './openapi.json',
  });
};

const generatorConfigs = {
  typescript: {
    name: async (isMultipleGenerators = false) => {
      const defaultName =
        await guessTypescriptPackageName(isMultipleGenerators);
      return input({
        message: 'SDK package name:',
        default: defaultName,
      });
    },
    spec: specInput,
    output: async () => {
      let defaultValue = './ts-sdk';
      const monorepo = await detectMonorepo();
      if (monorepo === 'nx') {
        defaultValue = './packages/ts-sdk';
      }
      return await input({
        message: 'Output directory:',
        default: defaultValue,
      });
    },
    mode: async () => {
      const options = {
        mode: 'full' as 'full' | 'minimal',
        install: false,
      };
      options.mode = await select({
        message: 'Generation mode:',
        choices: [
          {
            name: 'Full (generates package.json and tsconfig.json)',
            value: 'full',
          },
          {
            name: 'Minimal (generates only the client TypeScript files)',
            value: 'minimal',
          },
        ],
        default: options.mode,
      });
      if (options.mode === 'full') {
        const installDeps = await confirm({
          message: 'Install dependencies automatically?',
          default: true,
        });
        options.install = installDeps;
      }
      return options;
    },
    pagination: async () => {
      let pagination: PaginationConfig | false = {
        guess: false,
      };
      const result = await confirm({
        message: 'Enable pagination support?',
        default: false,
      });
      if (result) {
        pagination.guess = await confirm({
          message: 'Would you like to guess pagination parameters?',
          default: false,
        });
      } else {
        pagination = false;
      }
      return pagination;
    },
    readme: () =>
      confirm({
        message: 'Generate README file?',
        default: true,
      }),
    defaultFormatter: () =>
      confirm({
        message: 'Use default formatter (prettier)?',
        default: true,
      }),
    framework: () =>
      input({
        message: 'Framework integrating with the SDK (optional):',
      }),
    formatter: () =>
      input({
        message:
          'Custom formatter command (optional, e.g., "prettier $SDK_IT_OUTPUT --write"):',
      }),
  },
  python: {
    name: () =>
      input({
        message: 'SDK package name:',
        default: 'my-python-sdk',
      }),
    spec: specInput,
    output: () =>
      input({
        message: 'Output directory:',
        default: './python-sdk',
      }),
    mode: async () => {
      const isMonorepo = await detectMonorepo();
      return select({
        message: 'Generation mode:',
        choices: [
          {
            name: 'Full (generates complete project structure)',
            value: 'full',
          },
          {
            name: 'Minimal (generates only the client files)',
            value: 'minimal',
          },
        ],
        default: isMonorepo ? 'full' : 'full', // Default to full, especially for monorepos
      }).then((value) => value as 'full' | 'minimal');
    },
    formatter: () =>
      input({
        message:
          'Custom formatter command (optional, e.g., "black $SDK_IT_OUTPUT" or "ruff format $SDK_IT_OUTPUT"):',
      }),
  },
  dart: {
    name: () =>
      input({
        message: 'SDK package name:',
        default: 'my-dart-sdk',
      }),
    spec: specInput,
    output: () =>
      input({
        message: 'Output directory:',
        default: './dart-sdk',
      }),
    mode: async () => {
      const isMonorepo = await detectMonorepo();
      return select({
        message: 'Generation mode:',
        choices: [
          {
            name: 'Full (generates complete project structure)',
            value: 'full',
          },
          {
            name: 'Minimal (generates only the client files)',
            value: 'minimal',
          },
        ],
        default: isMonorepo ? 'full' : 'full', // Default to full, especially for monorepos
      }).then((value) => value as 'full' | 'minimal');
    },
    pagination: async () => {
      let pagination: PaginationConfig | false = {
        guess: false,
      };
      const result = await confirm({
        message: 'Enable pagination support?',
        default: false,
      });
      if (result) {
        pagination.guess = await confirm({
          message: 'Would you like to guess pagination parameters?',
          default: false,
        });
      } else {
        pagination = false;
      }
      return pagination;
    },
  },
};

const init = new Command('init')
  .description('Initialize SDK-IT configuration interactively')
  .action(async () => {
    console.log("Welcome to SDK-IT! Let's set up your configuration.\n");

    const possibleSpecFile = await findSpecFile();
    const monorepo = await detectMonorepo();

    if (possibleSpecFile) {
      console.log(`🔍 Auto-detected API specification: ${possibleSpecFile}`);
    }
    if (monorepo) {
      console.log(`📦 Detected monorepo setup`);
    }

    if (possibleSpecFile || monorepo) {
      console.log(''); // Add spacing
    }

    const config: SdkConfig = {
      generators: {},
    };

    // Ask which generators to configure
    const generators = await checkbox({
      message: 'Which SDK generators would you like to configure?',
      loop: false,
      instructions: false,
      required: true,

      choices: [
        { name: 'TypeScript', value: 'typescript' },
        { name: 'Python', value: 'python' },
        { name: 'Dart', value: 'dart' },
      ],
    });
    // Configure each selected generator
    for (const generator of generators) {
      console.log(`\nConfiguring ${generator} generator:`);

      if (generator === 'typescript') {
        const tsConfig = generatorConfigs.typescript;
        const isMultipleGenerators = generators.length > 1;

        const generatorConfig: TypeScriptOptions = {
          spec: await tsConfig.spec(possibleSpecFile),
          output: await tsConfig.output(),
          name: await tsConfig.name(isMultipleGenerators),
          defaultFormatter: await tsConfig.defaultFormatter(),
          readme: await tsConfig.readme(),
          pagination: await tsConfig.pagination(),
          ...(await tsConfig.mode()),
        };

        const customFramework = await tsConfig.framework();
        if (customFramework) {
          generatorConfig.framework = customFramework;
        }

        const customFormatter = await tsConfig.formatter();
        if (customFormatter) {
          generatorConfig.formatter = customFormatter;
        }

        config.generators.typescript = generatorConfig;
      } else if (generator === 'python') {
        config.generators.python = {
          spec: await generatorConfigs.python.spec(),
          output: await generatorConfigs.python.output(),
          mode: await generatorConfigs.python.mode(),
          name: await generatorConfigs.python.name(),
        };
      } else if (generator === 'dart') {
        config.generators.dart = {
          spec: await generatorConfigs.dart.spec(),
          output: await generatorConfigs.dart.output(),
          mode: await generatorConfigs.dart.mode(),
          name: await generatorConfigs.dart.name(),
          pagination: await generatorConfigs.dart.pagination(),
        };
      }
    }

    // Ask about README generation
    const generateReadme = await confirm({
      message: '\nGenerate README documentation?',
      default: true,
    });

    if (generateReadme) {
      const readmeSpec = await input({
        message: 'OpenAPI specification for README:',
        default:
          config.generators.typescript?.spec ||
          possibleSpecFile ||
          './openapi.yaml',
      });

      const readmeOutput = await input({
        message: 'README output file:',
        default: './README.md',
      });

      config.readme = {
        spec: readmeSpec,
        output: readmeOutput,
      };
    }

    // Ask about API reference generation
    const generateApiRef = await confirm({
      message: '\nGenerate API reference documentation?',
      default: false,
    });

    if (generateApiRef) {
      const autoDetected = await findSpecFile();
      const apirefSpec = await input({
        message: 'OpenAPI specification for API reference:',
        default:
          config.generators.typescript?.spec ||
          autoDetected ||
          './openapi.yaml',
      });

      const apirefOutput = await input({
        message: 'API reference output directory:',
        default: './docs',
      });

      config.apiref = {
        spec: apirefSpec,
        output: apirefOutput,
      };
    }

    // Write configuration file
    const configPath = resolve(process.cwd(), 'sdk-it.json');
    await writeFile(configPath, JSON.stringify(config, null, 2));

    // Show comprehensive next steps
    console.log(`\n✅ Configuration saved to ${configPath}`);
    console.log('\n🚀 Next Steps:\n');

    // Step 1: Generate SDKs
    console.log('1. Generate your SDK(s):');
    console.log('   npx @sdk-it/cli');

    // Step 2: Integration examples based on selected generators
    if (config.generators.typescript) {
      console.log('2. Integrate TypeScript SDK:');
      const importName = config.generators.typescript.name.replace(
        /[^a-zA-Z0-9]/g,
        '',
      );
      const outputDir = config.generators.typescript.output.replace('./', '');
      console.log(`   import { ${importName} } from './${outputDir}';`);
      console.log(`   const client = new ${importName}();`);
      console.log(`   const result = await client.request('GET /users');\n`);
    }

    if (config.generators.python) {
      console.log('2. Integrate Python SDK:');
      const outputDir = config.generators.python.output.replace('./', '');
      console.log(`   # Add to your Python path or install locally`);
      console.log(`   from ${outputDir} import Client`);
      console.log(`   client = Client()`);
      console.log(`   result = client.users.list_users()\n`);
    }

    if (config.generators.dart) {
      console.log('2. Integrate Dart SDK:');
      const outputDir = config.generators.dart.output.replace('./', '');
      console.log(`   # Add dependency to pubspec.yaml`);
      console.log(`   import 'package:${outputDir}/client.dart';`);
      console.log(`   final client = Client();`);
      console.log(`   final result = await client.users.listUsers();\n`);
    }

    // Step 3: Documentation
    console.log('3. Check generated documentation:');
    const outputs: string[] = [];
    if (config.generators.typescript)
      outputs.push(config.generators.typescript.output);
    if (config.generators.python) outputs.push(config.generators.python.output);
    if (config.generators.dart) outputs.push(config.generators.dart.output);

    outputs.forEach((output) => {
      if (output) {
        console.log(
          `   📖 ${output}/README.md - Usage examples and API reference`,
        );
      }
    });

    if (config.readme) {
      console.log(
        `   📖 ${config.readme.output} - Generated API documentation`,
      );
    }

    if (config.apiref) {
      console.log(`   🌐 ${config.apiref.output} - Interactive API reference`);
    }

    console.log('\n4. Useful commands:');
    console.log(
      '   npx @sdk-it/cli          # Regenerate SDKs after API changes',
    );
    console.log(
      '   npx @sdk-it/cli typescript --help # See TypeScript-specific options',
    );
    console.log(
      '   npx @sdk-it/cli python --help     # See Python-specific options',
    );
    console.log(
      '   npx @sdk-it/cli dart --help       # See Dart-specific options',
    );

    console.log('\n💡 Tips:');
    console.log(
      '   • Update your API spec and re-run `npx @sdk-it/cli generate` to sync changes',
    );
    console.log(
      '   • Generated SDKs include TypeScript definitions for excellent IDE support',
    );
    console.log(
      '   • Check the README files for authentication and configuration options',
    );

    console.log('\n📚 Need help?');
    console.log('   • Documentation: https://sdk-it.dev/docs');
    console.log(
      '   • Examples: https://github.com/JanuaryLabs/sdk-it/tree/main/docs/examples',
    );
    console.log('   • Issues: https://github.com/JanuaryLabs/sdk-it/issues');

    console.log('\nHappy coding! 🎉\n');
  });

export default init;
