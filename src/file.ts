import { BuildResult } from './types/GodotExport';
import path from 'path';
import * as io from '@actions/io';
import { exec } from '@actions/exec';
import * as fs from 'fs';
import {
  ARCHIVE_ROOT_FOLDER,
  DESKTOP_PLATFORMS,
  GODOT_ARCHIVE_PATH,
  GODOT_PROJECT_PATH,
  RELATIVE_EXPORT_PATH,
  RELATIVE_PROJECT_PATH,
  STEAM_SDK_TARGET_PATH,
  USE_PRESET_EXPORT_PATH,
} from './constants';
import * as core from '@actions/core';

async function assembleSteamContentsFor(
  platform: typeof DESKTOP_PLATFORMS[keyof typeof DESKTOP_PLATFORMS],
  buildDir: string,
): Promise<void> {
  const projectPath = path.resolve(RELATIVE_PROJECT_PATH);
  const libPath = path.join(projectPath, STEAM_SDK_TARGET_PATH[platform]);

  core.info(`Assembling steam contents for ${platform}`);

  if (platform === DESKTOP_PLATFORMS.windows) {
    await exec('mv', [libPath, buildDir]);
  }
}

async function zipBuildResults(buildResults: BuildResult[]): Promise<void> {
  core.startGroup('⚒️ Zipping binaries');
  const promises: Promise<void>[] = [];
  for (const buildResult of buildResults) {
    promises.push(zipBuildResult(buildResult));
  }
  await Promise.all(promises);
  core.endGroup();
}

// @TODO: Implement me
// async function _moveSteamAPPID() {}

async function zipBuildResult(buildResult: BuildResult): Promise<void> {
  await io.mkdirP(GODOT_ARCHIVE_PATH);

  const zipPath = path.join(GODOT_ARCHIVE_PATH, `${buildResult.sanitizedName}.zip`);

  const isMac = buildResult.preset.platform.toLowerCase() === 'mac osx';
  const endsInDotApp = !!buildResult.preset.export_path.match('.app$');

  // in case mac doesn't export a zip, move the file
  if (isMac && !endsInDotApp) {
    const baseName = path.basename(buildResult.preset.export_path);
    const macPath = path.join(buildResult.directory, baseName);
    await io.cp(macPath, zipPath);
  } else if (!fs.existsSync(zipPath)) {
    core.info(`Zipping for ${buildResult.preset.platform}`);
    if (buildResult.preset.platform in Object.values(DESKTOP_PLATFORMS)) {
      // @ts-expect-error: we're narrowing the type in the line above
      await assembleSteamContentsFor(buildResult.preset.platform, buildResult.directory);
    }
    await exec('7z', ['a', zipPath, `${buildResult.directory}${ARCHIVE_ROOT_FOLDER ? '' : '/*'}`]);
  }

  buildResult.archivePath = zipPath;
}

async function moveBuildsToExportDirectory(buildResults: BuildResult[], moveArchived?: boolean): Promise<void> {
  core.startGroup(`➡️ Moving exports`);
  const promises: Promise<void>[] = [];
  for (const buildResult of buildResults) {
    const fullExportPath = path.resolve(
      USE_PRESET_EXPORT_PATH
        ? path.join(GODOT_PROJECT_PATH, path.dirname(buildResult.preset.export_path))
        : RELATIVE_EXPORT_PATH,
    );

    await io.mkdirP(fullExportPath);

    let promise: Promise<void>;
    if (moveArchived) {
      if (!buildResult.archivePath) {
        core.warning('Attempted to move export output that was not archived. Skipping');
        continue;
      }
      const newArchivePath = path.join(fullExportPath, path.basename(buildResult.archivePath));
      core.info(`Copying ${buildResult.archivePath} to ${newArchivePath}`);
      promise = io.cp(buildResult.archivePath, newArchivePath);
      buildResult.archivePath = newArchivePath;
    } else {
      core.info(`Copying ${buildResult.directory} to ${fullExportPath}`);
      promise = io.cp(buildResult.directory, fullExportPath, { recursive: true });
      buildResult.directory = path.join(fullExportPath, path.basename(buildResult.directory));
      buildResult.executablePath = path.join(buildResult.directory, path.basename(buildResult.executablePath));
    }

    promises.push(promise);
  }

  await Promise.all(promises);
  core.endGroup();
}

export { zipBuildResults, moveBuildsToExportDirectory };
