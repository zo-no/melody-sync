import {
  API_REQUEST_LOGS_DIR,
  CHAT_RUNS_DIR,
  CODEX_MANAGED_HOME_DIR,
  CONFIG_DIR,
  MELODYSYNC_APP_ROOT,
  MELODYSYNC_RUNTIME_ROOT,
} from './config.mjs';
import { join, resolve } from 'path';
import {
  DEFAULT_STORAGE_RETENTION_DAYS,
  applyStorageMaintenancePlan,
  collectStorageMaintenancePlan,
  formatStorageMaintenanceReport,
} from './storage-maintenance.mjs';

function printHelp(stdout = process.stdout) {
  stdout.write(`Usage:
  melodysync storage-maintenance [options]

Options:
  --apply                         Delete eligible files instead of only reporting
  --runtime-root <path>          Override the MelodySync runtime root to inspect
  --app-root <path>              Legacy alias for --runtime-root
  --api-log-days <count>         Keep API logs newer than N days (default: ${DEFAULT_STORAGE_RETENTION_DAYS.apiLogs})
  --run-payload-days <count>     Keep terminal run spool/artifacts newer than N days (default: ${DEFAULT_STORAGE_RETENTION_DAYS.runPayloads})
  --provider-session-days <count> Keep managed Codex raw sessions/snapshots newer than N days (default: ${DEFAULT_STORAGE_RETENTION_DAYS.providerSessions})
  --now <timestamp>              Override the cutoff anchor time (ISO timestamp)
  --json                         Print machine-readable JSON
  --help                         Show this help
`);
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveInteger(value, fallback, flagName) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid value for ${flagName}: ${value || '(missing)'}`);
  }
  return parsed;
}

function parseTimestamp(value, flagName) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid value for ${flagName}: ${value || '(missing)'}`);
  }
  return parsed;
}

function parseArgs(argv = []) {
  const options = {
    apply: false,
    help: false,
    json: false,
    runtimeRoot: '',
    apiLogDays: DEFAULT_STORAGE_RETENTION_DAYS.apiLogs,
    runPayloadDays: DEFAULT_STORAGE_RETENTION_DAYS.runPayloads,
    providerSessionDays: DEFAULT_STORAGE_RETENTION_DAYS.providerSessions,
    nowMs: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--apply':
        options.apply = true;
        break;
      case '--runtime-root':
      case '--app-root':
        options.runtimeRoot = trimString(argv[index + 1]);
        index += 1;
        break;
      case '--api-log-days':
        options.apiLogDays = parsePositiveInteger(argv[index + 1], options.apiLogDays, '--api-log-days');
        index += 1;
        break;
      case '--run-payload-days':
        options.runPayloadDays = parsePositiveInteger(argv[index + 1], options.runPayloadDays, '--run-payload-days');
        index += 1;
        break;
      case '--provider-session-days':
        options.providerSessionDays = parsePositiveInteger(argv[index + 1], options.providerSessionDays, '--provider-session-days');
        index += 1;
        break;
      case '--now':
        options.nowMs = parseTimestamp(argv[index + 1], '--now');
        index += 1;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function resolveCommandPaths(runtimeRootOverride) {
  if (runtimeRootOverride) {
    const runtimeRoot = resolve(runtimeRootOverride);
    return {
      basePath: runtimeRoot,
      apiRequestLogsDir: join(runtimeRoot, 'logs', 'api'),
      chatRunsDir: join(runtimeRoot, 'sessions', 'runs'),
      codexManagedHomeDir: join(runtimeRoot, 'config', 'provider-runtime-homes', 'codex'),
    };
  }
  return {
    basePath: MELODYSYNC_RUNTIME_ROOT || MELODYSYNC_APP_ROOT || CONFIG_DIR,
    apiRequestLogsDir: API_REQUEST_LOGS_DIR,
    chatRunsDir: CHAT_RUNS_DIR,
    codexManagedHomeDir: CODEX_MANAGED_HOME_DIR,
  };
}

export async function runStorageMaintenanceCommand(argv = [], io = {}) {
  const stdout = io.stdout || process.stdout;
  const options = parseArgs(argv);
  if (options.help) {
    printHelp(stdout);
    return 0;
  }

  const paths = resolveCommandPaths(options.runtimeRoot);
  const plan = await collectStorageMaintenancePlan({
    ...paths,
    appRoot: paths.basePath,
    apiLogDays: options.apiLogDays,
    runPayloadDays: options.runPayloadDays,
    providerSessionDays: options.providerSessionDays,
    nowMs: options.nowMs,
  });

  let result = null;
  if (options.apply) {
    result = await applyStorageMaintenancePlan(plan);
  }

  if (options.json) {
    stdout.write(`${JSON.stringify(result ? { plan, result } : { plan }, null, 2)}\n`);
    return 0;
  }

  stdout.write(formatStorageMaintenanceReport(plan, result));
  return result?.failedCount ? 1 : 0;
}
