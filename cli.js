#!/usr/bin/env node
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const [,, command, ...args] = process.argv;

function scriptPath(name) {
  return path.join(__dirname, name);
}

function runShell(script) {
  try {
    execFileSync('bash', [scriptPath(script)], { stdio: 'inherit' });
  } catch (err) {
    process.exit(err.status ?? 1);
  }
}

function printHelp() {
  console.log(`melodysync v${pkg.version}

Usage:
  melodysync setup                    Run local interactive setup
  melodysync start                    Start all services
  melodysync stop                     Stop all services
  melodysync restart [service]        Restart services (chat|all)
  melodysync release                  Create, gate, and activate a release snapshot
  melodysync guest-instance           Create isolated instances on this machine
  melodysync chat                     Run chat server in foreground
  melodysync api                      Call the local MelodySync HTTP API with owner auth
  melodysync usage-summary            Summarize local Codex token usage
  melodysync storage-maintenance      Report or prune reclaimable runtime storage
  melodysync session-spawn            Spawn a focused parallel session from a source session
  melodysync generate-token           Generate a new access token
  melodysync set-password             Set username & password for login
  melodysync --help                   Show this help message
  melodysync --version                Show version`);
}

switch (command) {
  case 'setup':
    runShell('setup.sh');
    break;

  case 'start':
    runShell('start.sh');
    break;

  case 'stop':
    runShell('stop.sh');
    break;

  case 'restart': {
    const service = args[0] || 'all';
    try {
      execFileSync('bash', [scriptPath('restart.sh'), service], { stdio: 'inherit' });
    } catch (err) {
      process.exit(err.status ?? 1);
    }
    break;
  }

  case 'chat':
    await import(scriptPath('chat-server.mjs'));
    break;

  case 'release': {
    const { runReleaseCommand } = await import(scriptPath('lib/release-command.mjs'));
    try {
      process.exitCode = await runReleaseCommand(args);
    } catch (error) {
      console.error(error.message || String(error));
      process.exit(1);
    }
    break;
  }

  case 'guest-instance':
  case 'guest-instances': {
    const { runGuestInstanceCommand } = await import(scriptPath('lib/guest-instance-command.mjs'));
    try {
      process.exitCode = await runGuestInstanceCommand(args);
    } catch (error) {
      console.error(error.message || String(error));
      process.exit(1);
    }
    break;
  }

  case 'api': {
    const { runMelodySyncApiCommand } = await import(scriptPath('lib/melodysync-api-command.mjs'));
    try {
      process.exitCode = await runMelodySyncApiCommand(args);
    } catch (error) {
      console.error(error.message || String(error));
      process.exit(1);
    }
    break;
  }

  case 'usage-summary': {
    const { runUsageSummaryCommand } = await import(scriptPath('lib/usage-summary-command.mjs'));
    try {
      process.exitCode = await runUsageSummaryCommand(args);
    } catch (error) {
      console.error(error.message || String(error));
      process.exit(1);
    }
    break;
  }

  case 'storage-maintenance': {
    const { runStorageMaintenanceCommand } = await import(scriptPath('lib/storage-maintenance-command.mjs'));
    try {
      process.exitCode = await runStorageMaintenanceCommand(args);
    } catch (error) {
      console.error(error.message || String(error));
      process.exit(1);
    }
    break;
  }

  case 'session-spawn':
  case 'spawn-session': {
    const { runSessionSpawnCommand } = await import(scriptPath('lib/session-spawn-command.mjs'));
    try {
      process.exitCode = await runSessionSpawnCommand(args);
    } catch (error) {
      console.error(error.message || String(error));
      process.exit(1);
    }
    break;
  }

  case 'generate-token': {
    try {
      execFileSync('node', [scriptPath('generate-token.mjs')], { stdio: 'inherit' });
    } catch (err) {
      process.exit(err.status ?? 1);
    }
    break;
  }

  case 'set-password': {
    await import(scriptPath('set-password.mjs'));
    break;
  }

  case '--version':
  case '-v':
    console.log(pkg.version);
    break;

  case '--help':
  case '-h':
  case undefined:
    printHelp();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    console.error('Run "melodysync --help" for usage.');
    process.exit(1);
}
