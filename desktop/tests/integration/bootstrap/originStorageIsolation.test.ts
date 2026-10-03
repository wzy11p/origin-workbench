import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerPlatformServices } from '@/common/platform';
import { NodePlatformServices } from '@/common/platform/NodePlatformServices';
import { getConfigPath, getDataPath, getTempPath } from '@/process/utils/utils';

const electron = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    getPath: vi.fn<(name: string) => string>(),
    setPath: vi.fn(),
    setName: vi.fn(),
    disableHardwareAcceleration: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
  },
}));
vi.mock('electron', () => electron);

let fixtureRoot: string;
let homeDir: string;
let tempDir: string;
let dataDir: string;
let services: NodePlatformServices;

function selectDataDir(directory: string): void {
  dataDir = directory;
  vi.stubEnv('ORIGIN_DATA_DIR', directory);
}

async function loadChromiumConfiguration(): Promise<void> {
  vi.resetModules();
  await import('@/process/utils/configureChromium');
}

beforeEach(() => {
  fixtureRoot = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'origin-storage-')));
  homeDir = path.join(fixtureRoot, 'home');
  tempDir = path.join(fixtureRoot, 'temp');
  dataDir = path.join(fixtureRoot, '原点 工作台', 'data');
  for (const directory of [homeDir, tempDir, dataDir]) mkdirSync(directory, { recursive: true });
  services = new NodePlatformServices();
  services.paths = {
    ...services.paths,
    getDataDir: () => dataDir,
    getHomeDir: () => homeDir,
    getTempDir: () => tempDir,
    needsCliSafeSymlinks: () => true,
    isPackaged: () => false,
  };
  registerPlatformServices(services);
  vi.stubEnv('ORIGIN_ROOT', path.join(fixtureRoot, 'checkout'));
  vi.stubEnv('ORIGIN_DATA_DIR', dataDir);
  vi.stubEnv('AIONUI_MULTI_INSTANCE', undefined);
  vi.stubEnv('AIONUI_CDP_PORT', '0');
  vi.stubEnv('AIONUI_E2E_TEST', undefined);
  vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
  electron.app.getPath.mockImplementation((name) => (name === 'home' ? homeDir : dataDir));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  registerPlatformServices(new NodePlatformServices());
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe('origin storage isolation — normal', () => {
  it('writes through its own CLI-safe aliases into the selected data directory', () => {
    const workDir = getDataPath();
    const configDir = getConfigPath();
    expect([path.basename(workDir), path.basename(configDir)]).toEqual([
      expect.stringMatching(/^\.origin-workbench-[a-f0-9]+$/),
      expect.stringMatching(/^\.origin-workbench-config-[a-f0-9]+$/),
    ]);
    writeFileSync(path.join(workDir, 'document.txt'), 'origin document');
    writeFileSync(path.join(configDir, 'preferences.txt'), 'origin preferences');
    expect(readFileSync(path.join(dataDir, 'aionui', 'document.txt'), 'utf8')).toBe('origin document');
    expect(readFileSync(path.join(dataDir, 'config', 'preferences.txt'), 'utf8')).toBe('origin preferences');
  });

  it.each([
    { packaged: false, multi: undefined, suffix: '-dev' },
    { packaged: false, multi: '1', suffix: '-dev-2' },
    { packaged: true, multi: undefined, suffix: '' },
  ])('preserves non-Origin aliases for $suffix mode', ({ packaged, multi, suffix }) => {
    vi.stubEnv('ORIGIN_ROOT', undefined);
    vi.stubEnv('AIONUI_MULTI_INSTANCE', multi);
    services.paths.isPackaged = () => packaged;
    expect(getDataPath()).toBe(path.join(homeDir, `.aionui${suffix}`));
    expect(getConfigPath()).toBe(path.join(homeDir, `.aionui-config${suffix}`));
    expect(getTempPath()).toBe(path.join(tempDir, 'aionui'));
  });

  it('reuses the same aliases when a profile is reached through a different directory symlink', () => {
    const firstAlias = getDataPath();
    const firstTarget = readlinkSync(firstAlias);
    const profileLink = path.join(fixtureRoot, 'profile-link');
    symlinkSync(dataDir, profileLink, 'dir');
    selectDataDir(profileLink);
    expect(getDataPath()).toBe(firstAlias);
    expect(readlinkSync(firstAlias)).toBe(firstTarget);
  });

  it('keeps the alias stable when the selected directory does not exist yet', () => {
    selectDataDir(path.join(fixtureRoot, 'new', 'profile'));
    const firstAlias = getDataPath();
    expect(getDataPath()).toBe(firstAlias);
    expect(realpathSync(firstAlias)).toBe(path.join(realpathSync(dataDir), 'aionui'));
  });

  it('retains the old registry cleanup when Origin mode is absent', async () => {
    vi.stubEnv('ORIGIN_ROOT', undefined);
    const registry = path.join(homeDir, '.aionui-cdp-registry.json');
    writeFileSync(registry, '{"legacy":true}');
    await loadChromiumConfiguration();
    expect(existsSync(registry)).toBe(false);
  });
});

describe('origin storage isolation — adversarial', () => {
  it('leaves the old application aliases pointing at their original data', () => {
    const oldDataDir = path.join(fixtureRoot, 'old-data');
    const oldConfigDir = path.join(fixtureRoot, 'old-config');
    for (const directory of [oldDataDir, oldConfigDir]) mkdirSync(directory);
    const oldDataAlias = path.join(homeDir, '.aionui-dev');
    const oldConfigAlias = path.join(homeDir, '.aionui-config-dev');
    symlinkSync(oldDataDir, oldDataAlias, 'dir');
    symlinkSync(oldConfigDir, oldConfigAlias, 'dir');
    getDataPath();
    getConfigPath();
    expect(readlinkSync(oldDataAlias)).toBe(oldDataDir);
    expect(readlinkSync(oldConfigAlias)).toBe(oldConfigDir);
  });

  it('keeps two Origin profiles independent while both hold their earlier aliases', () => {
    const firstProfile = dataDir;
    const firstAlias = getDataPath();
    writeFileSync(path.join(firstAlias, 'document.txt'), 'first project');
    selectDataDir(path.join(fixtureRoot, 'second-profile'));
    mkdirSync(dataDir);
    const secondAlias = getDataPath();
    writeFileSync(path.join(secondAlias, 'document.txt'), 'second project');
    expect(firstAlias).not.toBe(secondAlias);
    expect(readFileSync(path.join(firstAlias, 'document.txt'), 'utf8')).toBe('first project');
    expect(readFileSync(path.join(firstProfile, 'aionui', 'document.txt'), 'utf8')).toBe('first project');
  });

  it('never exposes the old application temporary configuration to Origin migration', () => {
    const oldTemp = path.join(tempDir, 'aionui');
    mkdirSync(oldTemp);
    writeFileSync(path.join(oldTemp, 'aionui-config.txt'), 'old private configuration');
    const originTemp = getTempPath();
    expect(existsSync(path.join(originTemp, 'aionui-config.txt'))).toBe(false);
    selectDataDir(path.join(fixtureRoot, 'other-profile'));
    expect(getTempPath()).not.toBe(originTemp);
    expect(readFileSync(path.join(oldTemp, 'aionui-config.txt'), 'utf8')).toBe('old private configuration');
  });

  it('does not replace a regular file occupying its own alias', () => {
    const alias = getDataPath();
    unlinkSync(alias);
    writeFileSync(alias, 'unrelated user file');
    const resolved = getDataPath();
    expect(readFileSync(alias, 'utf8')).toBe('unrelated user file');
    expect(resolved).toBe(path.join(realpathSync(dataDir), 'aionui'));
  });

  it('does not redirect an alias that was changed to an unrelated directory', () => {
    const alias = getConfigPath();
    unlinkSync(alias);
    const otherDirectory = path.join(fixtureRoot, 'unrelated');
    mkdirSync(otherDirectory);
    symlinkSync(otherDirectory, alias, 'dir');
    expect(getConfigPath()).toBe(path.join(realpathSync(dataDir), 'config'));
    expect(readlinkSync(alias)).toBe(otherDirectory);
  });

  it('does not delete the old application browser registry when Origin starts', async () => {
    const registry = path.join(homeDir, '.aionui-cdp-registry.json');
    writeFileSync(registry, '{"legacy":true}');
    await loadChromiumConfiguration();
    expect(readFileSync(registry, 'utf8')).toBe('{"legacy":true}');
  });
});
