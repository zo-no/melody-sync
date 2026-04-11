import { statSync } from 'fs';
import { homedir } from 'os';
import { join, relative, resolve, sep } from 'path';
import { trimText } from './text.mjs';

function normalizeHomeDir(homeDir = homedir()) {
  return resolve(homeDir || homedir());
}

export function resolveSessionFolderPath(folder, homeDir = homedir()) {
  const normalizedHome = normalizeHomeDir(homeDir);
  const trimmed = trimText(folder);
  if (!trimmed || trimmed === '~') return normalizedHome;
  if (trimmed.startsWith('~/')) return join(normalizedHome, trimmed.slice(2));
  return resolve(trimmed);
}

function isDirectoryPathSync(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function canonicalizeResolvedFolder(resolvedFolder, homeDir = homedir()) {
  const normalizedHome = normalizeHomeDir(homeDir);
  const normalizedResolved = resolve(resolvedFolder || normalizedHome);
  if (normalizedResolved === normalizedHome) return '~';

  const relativeToHome = relative(normalizedHome, normalizedResolved);
  if (
    relativeToHome
    && relativeToHome !== '.'
    && !relativeToHome.startsWith(`..${sep}`)
    && relativeToHome !== '..'
  ) {
    return `~/${relativeToHome.split(sep).join('/')}`;
  }

  return normalizedResolved;
}

function buildCurrentHomeRebaseCandidate(resolvedFolder, homeDir = homedir()) {
  const normalizedHome = normalizeHomeDir(homeDir).replace(/\\/g, '/');
  const normalizedResolved = resolve(resolvedFolder || '').replace(/\\/g, '/');
  const match = normalizedResolved.match(/^\/(?:Users|home)\/[^/]+(?:\/(.*))?$/);
  if (!match) return '';

  const suffix = match[1]
    ? match[1].split('/').filter(Boolean)
    : [];
  const candidate = resolve(join(normalizedHome, ...suffix));
  if (candidate.replace(/\\/g, '/') === normalizedResolved) {
    return '';
  }
  return candidate;
}

export function canonicalizeSessionFolder(folder, options = {}) {
  const trimmed = trimText(folder);
  if (!trimmed) return '~';
  return canonicalizeResolvedFolder(
    resolveSessionFolderPath(trimmed, options.homeDir),
    options.homeDir,
  );
}

export function inspectSessionFolder(folder, options = {}) {
  const normalizedHome = normalizeHomeDir(options.homeDir);
  const trimmed = trimText(folder) || '~';
  const resolvedFolder = resolveSessionFolderPath(trimmed, normalizedHome);
  const canonicalFolder = canonicalizeResolvedFolder(resolvedFolder, normalizedHome);

  if (isDirectoryPathSync(resolvedFolder)) {
    return {
      available: true,
      changed: canonicalFolder !== trimmed,
      originalFolder: trimmed,
      storedFolder: canonicalFolder,
      resolvedFolder,
      repairKind: canonicalFolder !== trimmed ? 'canonicalize' : 'none',
    };
  }

  const rebasedHomeFolder = buildCurrentHomeRebaseCandidate(resolvedFolder, normalizedHome);
  if (rebasedHomeFolder && isDirectoryPathSync(rebasedHomeFolder)) {
    const rebasedStoredFolder = canonicalizeResolvedFolder(rebasedHomeFolder, normalizedHome);
    return {
      available: true,
      changed: rebasedStoredFolder !== trimmed,
      originalFolder: trimmed,
      storedFolder: rebasedStoredFolder,
      resolvedFolder: rebasedHomeFolder,
      repairKind: 'home_rebase',
    };
  }

  if (options.allowPersistentFallback === true && isDirectoryPathSync(normalizedHome)) {
    return {
      available: true,
      changed: trimmed !== '~',
      originalFolder: trimmed,
      storedFolder: '~',
      resolvedFolder: normalizedHome,
      repairKind: 'persistent_home_fallback',
    };
  }

  return {
    available: false,
    changed: false,
    originalFolder: trimmed,
    storedFolder: canonicalFolder,
    resolvedFolder,
    repairKind: 'missing',
  };
}

export function buildSessionFolderUnavailableMessage(folder) {
  const label = trimText(folder) || '~';
  return `Session working directory does not exist on this machine: ${label}. Update the session folder or recreate the session in a valid directory.`;
}
