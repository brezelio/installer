#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import prompts from 'prompts';
import { execa } from 'execa';
import fs from 'fs';
import path from 'path';
import ora from 'ora';

const program = new Command();

function stripAnsi(str: string) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, '');
}

function resetTerminal() {
  process.stdout.write('\u001b[0m');
}

async function runTask(title: string, cmd: string, args: string[], options: any) {
  const spinner = ora(title).start();
  const subprocess = execa(cmd, args, { ...options, all: true });

  subprocess.stdout?.on('data', (data) => {
    const line = stripAnsi(data.toString().trim().split('\n').pop() || '');
    if (line) {
      spinner.text = `${title} ${chalk.dim(`(${line.substring(0, 60).trim()}...)`)}`;
    }
  });

  subprocess.stderr?.on('data', (data) => {
    const line = stripAnsi(data.toString().trim().split('\n').pop() || '');
    if (line) {
      spinner.text = `${title} ${chalk.dim(`(${line.substring(0, 60).trim()}...)`)}`;
    }
  });

  try {
    await subprocess;
    resetTerminal();
    spinner.succeed(title);
  } catch (e: any) {
    resetTerminal();
    spinner.fail(`${title} failed.`);
    if (e.all) console.error(chalk.red(e.all));
    process.exit(1);
  }
}

function writeEnv(rootDir: string, updates: Record<string, string>) {
  const envPath = path.join(rootDir, '.env');
  const envExamplePath = path.join(rootDir, '.env.example');

  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf-8');
  } else if (fs.existsSync(envExamplePath)) {
    content = fs.readFileSync(envExamplePath, 'utf-8');
  }

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}=.*`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
  }

  fs.writeFileSync(envPath, content.trim() + '\n');
}

function parseEnv(rootDir: string): Record<string, string> {
    const envPath = path.join(rootDir, '.env');
    if (!fs.existsSync(envPath)) return {};
    
    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split('\n');
    const result: Record<string, string> = {};
    
    for (const line of lines) {
        const match = line.match(/^([^=#]+)=(.*)$/);
        if (match) {
            result[match[1].trim()] = match[2].trim();
        }
    }
    return result;
}

program
  .name('brezel-installer')
  .description('Installer for Brezel (SPA + API)')
  .version('1.0.0')
  .option('-d, --dir <directory>', 'Installation directory', './brezel')
  .option('-m, --mode <mode>', 'Installation mode (native, docker)', 'native')
  .option('-s, --system <name>', 'System name', 'example')
  .option('-u, --url <url>', 'API URL', 'http://brezel-api.test')
  .option('--spa-url <url>', 'SPA URL', 'http://localhost:5173')
  .option('--db-host <host>', 'Database host', '127.0.0.1')
  .option('--db-port <port>', 'Database port', '3306')
  .option('--db-name <name>', 'Database name', 'brezel_meta')
  .option('--db-user <user>', 'Database user', 'root')
  .option('--db-password <password>', 'Database password', '')
  .option('--php-path <path>', 'Path to PHP executable', 'php')
  .option('--gitlab-token <token>', 'GitLab Personal Access Token')
  .option('--no-interactive', 'Run in non-interactive mode')
  .option('--source-mode <mode>', 'Source control mode (clone, fork)', 'clone')
  .option('--components <list>', 'Optional components to install (mariadb, nginx, ssl, cron)', '');

const REPO_SKELETON = 'https://github.com/brezelio/brezel.git';

program.action(async (options) => {
  console.log(chalk.bold.blue('\n🥨 Welcome to the Brezel Installer!\n'));

  const initialRootDir = path.resolve(options.dir || './brezel');
  let isExistingBrezel = false;
  let existingEnv: Record<string, string> = {};

  // Detect existing Brezel installation early
  if (fs.existsSync(path.join(initialRootDir, 'composer.json')) && fs.existsSync(path.join(initialRootDir, 'systems'))) {
    try {
        const composerJson = JSON.parse(fs.readFileSync(path.join(initialRootDir, 'composer.json'), 'utf-8'));
        if (composerJson.require && composerJson.require['brezel/api']) {
            isExistingBrezel = true;
            existingEnv = parseEnv(initialRootDir);
            ora('Existing Brezel installation detected. Entering update mode.').info();
        }
    } catch (e) {}
  }

  const checkPhp = async (phpPath: string) => {
    try {
        const { stdout } = await execa(phpPath, ['-r', 'echo PHP_VERSION;']);
        // Use regex to find the version string (e.g. 8.3.1 or 8.4.14) in case of warnings
        const match = stdout.match(/(\d+)\.(\d+)\.(\d+)/);
        if (!match) return null;

        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        const version = match[0];

        return {
            version,
            valid: (major > 8 || (major === 8 && minor >= 3))
        };
    } catch (e) {
        return null;
    }
  };

  // 1. Prerequisites Check
  const spinner = ora('Checking prerequisites...').start();
  const checks: any = {};

  try {
    // Critical Deps
    for (const dep of ['git', 'node', 'npm']) {
      await execa(dep, ['--version']);
      checks[dep] = true;
    }

    // PHP version check
    const phpResult = await checkPhp(options.phpPath || 'php');
    if (phpResult) {
        checks.php = phpResult.version;
        checks.phpValid = phpResult.valid;
    } else {
        checks.php = false;
        checks.phpValid = false;
    }

    // Composer check
    try {
        await execa('composer', ['--version']);
        checks.composer = true;
    } catch (e) {
        checks.composer = false;
    }

    // Docker check
    try {
        await execa('docker', ['--version']);
        checks.docker = true;
    } catch (e) {
        checks.docker = false;
    }

    // Valet check (macOS only)
    if (process.platform === 'darwin') {
        try {
            await execa('valet', ['--version']);
            checks.valet = true;
        } catch (e) {
            checks.valet = false;
        }
    }

    spinner.succeed('System check complete.');
  } catch (error) {
    spinner.fail('Missing critical prerequisites (git, node, or npm).');
    process.exit(1);
  }

  let responses = options;

  if (options.interactive !== false) {
    const interactiveResponses = await prompts([
      {
        type: 'select',
        name: 'mode',
        message: 'How do you want to install Brezel?',
        choices: [
          {
            title: `Native (Bare metal) ${!checks.phpValid && checks.php ? chalk.yellow('(PHP 8.3+ required, current: ' + checks.php + ')') : (!checks.php ? chalk.red('(PHP not found)') : '')}`,
            value: 'native',
            disabled: false
          },
          ...(checks.valet ? [{
            title: `Valet (macOS Magic) ${chalk.dim('- handles domain mapping automatically')}`,
            value: 'valet'
          }] : []),
          {
            title: `Docker (Containerized) ${!checks.docker ? chalk.red('(Docker required)') : ''}`,
            value: 'docker',
            disabled: !checks.docker
          }
        ],
        initial: (options.mode === 'valet' && checks.valet) ? 1 : ((options.mode === 'docker' && checks.docker) ? (checks.valet ? 2 : 1) : 0)
      },
      {
        type: (prev, values) => (values.mode === 'native' || values.mode === 'valet') ? 'text' : null,
        name: 'phpPath',
        message: 'Path to PHP 8.3+ executable:',
        initial: options.phpPath || 'php',
        validate: async (val) => {
            const res = await checkPhp(val);
            if (!res) return 'PHP not found at this path.';
            if (!res.valid) return `PHP version ${res.version} is too old. 8.3+ required.`;
            return true;
        }
      },
      {
        type: isExistingBrezel ? null : 'select',
        name: 'sourceMode',
        message: 'Source control mode:',
        choices: [
          { title: 'Clone without history', value: 'clone' },
          { title: 'Fork and clone', value: 'fork' }
        ],
        initial: options.sourceMode === 'fork' ? 1 : 0
      },
      {
        type: (prev) => (!isExistingBrezel && prev === 'fork') ? 'text' : null,
        name: 'forkUrl',
        message: 'Enter your fork URL (git@...):',
        validate: (v) => v.length > 0 ? true : 'Fork URL is required'
      },
      {
        type: 'text',
        name: 'gitlabToken',
        message: 'GitLab Personal Access Token (for @kibro packages, scope: read_api, read_registry)',
        initial: options.gitlabToken,
        validate: (v) => (v && v.length > 0) ? true : 'Token is required'
      },
      {
        type: 'text',
        name: 'dir',
        message: 'Installation directory:',
        initial: options.dir
      },
      {
        type: 'text',
        name: 'system',
        message: 'System name:',
        initial: existingEnv['VITE_APP_SYSTEM'] || existingEnv['APP_SYSTEM'] || options.system
      },
      {
        type: 'text',
        name: 'url',
        message: 'API URL:',
        initial: (prev: any, values: any) => {
            if (existingEnv['APP_URL']) return existingEnv['APP_URL'];
            return options.url !== 'http://brezel-api.test' ? options.url : `http://${values.system}.test`;
        }
      },
      {
        type: 'text',
        name: 'spaUrl',
        message: 'SPA URL:',
        initial: (prev: any, values: any) => {
            if (existingEnv['VITE_APP_URL']) return existingEnv['VITE_APP_URL'];
            if (options.spaUrl !== 'http://localhost:5173') return options.spaUrl;
            if (values.mode === 'valet') return `http://${values.system}.test:5173`;
            return `http://localhost:5173`;
        }
      },
      {
        type: 'multiselect',
        name: 'components',
        message: 'Select optional components to install:',
        choices: [
          { title: 'MariaDB', value: 'mariadb' },
          { title: 'Nginx', value: 'nginx' },
          { title: 'SSL (Certbot)', value: 'ssl' },
          { title: 'Cron jobs', value: 'cron' }
        ],
        initial: (options.components && typeof options.components === 'string')
                    ? options.components.split(',').map(c => ['mariadb', 'nginx', 'ssl', 'cron'].indexOf(c))
                    : undefined
      },
      {
        type: 'text',
        name: 'dbHost',
        message: 'Database Host',
        initial: existingEnv['TENANCY_HOST'] || options.dbHost
      },
      {
        type: 'text',
        name: 'dbPort',
        message: 'Database Port',
        initial: existingEnv['TENANCY_PORT'] || options.dbPort
      },
      {
        type: 'text',
        name: 'dbName',
        message: 'Database Name',
        initial: existingEnv['TENANCY_DATABASE'] || options.dbName
      },
      {
        type: 'text',
        name: 'dbUser',
        message: 'Database User',
        initial: existingEnv['TENANCY_USERNAME'] || options.dbUser
      },
      {
        type: 'password',
        name: 'dbPassword',
        message: 'Database Password',
        initial: existingEnv['TENANCY_PASSWORD'] || options.dbPassword
      }
    ]);

    responses = { ...options, ...interactiveResponses };
  } else {
    responses = { ...options };

    // In non-interactive mode, parse components string into array
    if (typeof responses.components === 'string') {
        responses.components = responses.components.split(',').filter(Boolean);
    }
  }

  if (!responses.dir) process.exit(1);

  // Validation after response
  const isNative = responses.mode === 'native' || responses.mode === 'valet';

  if (isNative) {
    const phpRes = await checkPhp(responses.phpPath);
    if (!phpRes || !phpRes.valid) {
        ora(`Native/Valet mode requires PHP 8.3+, but version ${phpRes?.version || 'none'} was found at ${responses.phpPath}.`).fail();
        process.exit(1);
    }
    if (!checks.composer) {
        ora('Native/Valet mode requires Composer, but it was not found.').fail();
        process.exit(1);
    }
  } else if (responses.mode === 'docker' && !checks.docker) {
      ora('Docker mode requires Docker, but it was not found.').fail();
      process.exit(1);
  }

  const rootDir = path.resolve(responses.dir);
  let finalIsExistingBrezel = isExistingBrezel;

  // Re-detect if path changed during prompt
  if (rootDir !== initialRootDir) {
      if (fs.existsSync(path.join(rootDir, 'composer.json')) && fs.existsSync(path.join(rootDir, 'systems'))) {
          try {
              const composerJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'composer.json'), 'utf-8'));
              if (composerJson.require && composerJson.require['brezel/api']) {
                  finalIsExistingBrezel = true;
                  ora('Existing Brezel installation detected. Skipping clone.').info();
              }
          } catch (e) {}
      }
  }

  if (!finalIsExistingBrezel && !fs.existsSync(rootDir)) {
    const s = ora(`Cloning Brezel skeleton (${responses.sourceMode === 'clone' ? 'no history' : 'fork'})...`).start();
    try {
      const cloneUrl = responses.sourceMode === 'fork' ? responses.forkUrl : REPO_SKELETON;
      const cloneArgs = ['clone'];
      if (responses.sourceMode === 'clone') {
          cloneArgs.push('--depth', '1');
      }
      cloneArgs.push(cloneUrl, rootDir);

      await execa('git', cloneArgs);

      if (responses.sourceMode === 'clone') {
          fs.rmSync(path.join(rootDir, '.git'), { recursive: true, force: true });
          await execa('git', ['init'], { cwd: rootDir });
          await execa('git', ['add', '.'], { cwd: rootDir });
          await execa('git', ['commit', '-m', 'Initial commit from Brezel Installer'], { cwd: rootDir });
      }

      s.succeed('Brezel skeleton cloned.');
    } catch (e) {
      s.fail('Failed to clone repository.');
      console.error(e);
      process.exit(1);
    }
  }

  // 2. Optional Components (Bare metal only)
  if (responses.mode === 'native' && responses.components && responses.components.length > 0) {
      console.log(chalk.bold.cyan('\n🛠 Installing optional components...'));
      for (const component of responses.components) {
          const compSpinner = ora(`Installing ${component}...`).start();
          try {
              if (process.platform === 'linux') {
                  if (component === 'mariadb') {
                      await execa('sudo', ['apt-get', 'update']);
                      await execa('sudo', ['apt-get', 'install', '-y', 'mariadb-server']);
                      compSpinner.succeed('MariaDB installed.');
                  } else if (component === 'nginx') {
                      await execa('sudo', ['apt-get', 'install', '-y', 'nginx']);
                      compSpinner.succeed('Nginx installed.');
                  } else if (component === 'ssl') {
                      await execa('sudo', ['apt-get', 'install', '-y', 'certbot', 'python3-certbot-nginx']);
                      compSpinner.succeed('Certbot installed.');
                  } else if (component === 'cron') {
                      const cronJob = `* * * * * cd ${rootDir} && ${responses.phpPath} bakery schedule:run >> /dev/null 2>&1`;
                      compSpinner.info('Cron job suggested: ' + cronJob);
                  }
              } else if (process.platform === 'darwin') {
                  if (component === 'mariadb') {
                      await execa('brew', ['install', 'mariadb']);
                      compSpinner.succeed('MariaDB installed via Homebrew.');
                  } else if (component === 'nginx') {
                      await execa('brew', ['install', 'nginx']);
                      compSpinner.succeed('Nginx installed via Homebrew.');
                  } else {
                      compSpinner.warn(`${component} installation not fully automated for macOS.`);
                  }
              } else {
                  compSpinner.warn(`${component} installation not supported on this OS.`);
              }
          } catch (e) {
              compSpinner.fail(`Failed to install ${component}.`);
          }
      }
  }

  if (responses.mode === 'docker') {
      console.log(chalk.bold.cyan('\n🐳 Setting up Docker environment...'));

      writeEnv(rootDir, {
        APP_URL: responses.url,
        VITE_APP_API_URL: responses.url,
        VITE_APP_SYSTEM: responses.system,
        TENANCY_HOST: 'db',
        TENANCY_PASSWORD: 'password',
        APP_SYSTEM: responses.system
      });
      ora('Configured .env for Docker').succeed();

      await runTask('Building and starting Docker containers', 'docker', ['compose', 'up', '-d', '--build'], {
          cwd: rootDir,
          env: {
              ...process.env,
              COMPOSER_TOKEN: responses.gitlabToken,
              NPM_TOKEN: responses.gitlabToken,
              APP_SYSTEM: responses.system,
              APP_URL: responses.url
          }
      });

      console.log(chalk.bold.cyan('\n🥐 Initializing Brezel in Docker...'));
          const initSpinner = ora('Waiting for database...').start();

          await new Promise(r => setTimeout(r, 10000));

          const runDockerCmd = async (cmd: string[]) => {
              await execa('docker', ['compose', 'exec', 'api', ...cmd], { cwd: rootDir, stdio: 'inherit' });
          };

          try {
              initSpinner.text = 'Running bakery init...';
              await runDockerCmd(['php', 'bakery', 'init']);

              console.log(chalk.dim(`Creating system "${responses.system}"...`));
              await runDockerCmd(['php', 'bakery', 'system', 'create', responses.system]);

              console.log(chalk.dim('Applying system config...'));
              await runDockerCmd(['php', 'bakery', 'apply']);

              initSpinner.succeed('Brezel initialized in Docker.');

          } catch (e) {
              initSpinner.fail('Initialization in Docker failed.');
              console.error(e);
          }

      console.log(chalk.bold.green('\n✅ Docker Installation complete!'));
      console.log(chalk.white(`
Services are running:
  API: ${responses.url} (mapped to localhost:8081)
  SPA: ${responses.spaUrl} (mapped to localhost:3000)
  
To stop:
  cd ${rootDir}
  docker compose down
`));

      return;
  }

  // 3. Install Dependencies (Native/Valet Mode)
  if (isNative) {
    console.log(chalk.bold.cyan('\n📦 Installing Dependencies...'));

    await execa('composer', ['config', 'gitlab-token.gitlab.kiwis-and-brownies.de', responses.gitlabToken], { cwd: rootDir });

    await runTask('Installing PHP dependencies (Composer)', 'composer', ['install', '--no-interaction'], { cwd: rootDir });

    const npmrcPath = path.join(rootDir, '.npmrc');
    const npmrcContent = `
@kibro:registry=https://gitlab.kiwis-and-brownies.de/api/v4/packages/npm/
//gitlab.kiwis-and-brownies.de/api/v4/packages/npm/:_authToken=${responses.gitlabToken}
`;
    fs.writeFileSync(npmrcPath, npmrcContent);

    await runTask('Installing Node dependencies (npm)', 'npm', ['install'], { cwd: rootDir });

    writeEnv(rootDir, {
      APP_URL: responses.url,
      VITE_APP_API_URL: responses.url,
      VITE_APP_SYSTEM: responses.system,
      TENANCY_HOST: responses.dbHost,
      TENANCY_PORT: responses.dbPort,
      TENANCY_DATABASE: responses.dbName,
      TENANCY_USERNAME: responses.dbUser,
      TENANCY_PASSWORD: responses.dbPassword
    });
    ora('Configured .env').succeed();

    console.log(chalk.bold.cyan('\n🥐 Initializing Brezel...'));

    const runBakery = async (args: string[]) => {
        await execa(responses.phpPath, ['bakery', ...args], { cwd: rootDir, stdio: 'inherit' });
    };

    try {
        console.log(chalk.dim('Running initialization...'));
        await runBakery(['init']);
        console.log(chalk.dim(`Creating system "${responses.system}"...`));
        await runBakery(['system', 'create', responses.system]);
        console.log(chalk.dim('Applying system config...'));
        await runBakery(['apply']);
    } catch (e) {
        console.error(chalk.red('Initialization failed.'));
        console.error(e);
    }

    await runTask('Building SPA', 'npm', ['run', 'build'], { cwd: rootDir });

    // Valet specific setup
    if (responses.mode === 'valet') {
        console.log(chalk.bold.cyan('\n🎩 Valet Setup...'));
        try {
            await execa('valet', ['link', responses.system], { cwd: rootDir });
            ora(`Linked ${responses.system}.test to Valet.`).succeed();

            // Try to secure it
            if (responses.url.startsWith('https://')) {
                await execa('valet', ['secure', responses.system], { cwd: rootDir });
                ora(`Secured ${responses.system}.test with SSL.`).succeed();
            }
        } catch (e) {
            console.warn(chalk.yellow('Valet link/secure failed. You might need to run it manually.'));
        }
    }
  }

  console.log(chalk.bold.cyan('\n📦 Export Services'));
  console.log(chalk.white('To install export services (PDF, Excel, etc.), run:'));
  console.log(chalk.dim('  npx @kibro/export-installer@latest\n'));

  console.log(chalk.bold.green('\n✅ Installation complete!'));
  console.log(chalk.white(`
To start the server (API + SPA dev):
  cd ${responses.dir}
  npm run dev

For Windows users:
  bin\\serve_on_windows.ps1
`));
});

program.parse();
