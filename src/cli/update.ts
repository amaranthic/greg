/**
 * @fileoverview Subcommand for inspecting and updating the Greg binary to latest or specific versions.
 * @packageDocumentation
 */

import { Command } from "commander";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { brandColors, gregGitHubRepo, gregVersion } from "../constants/index.js";
import { resolveHomeDirectory } from "../settings/index.js";
import { writeToStderr, writeToStdout } from "../utils/index.js";

const execFileAsync = promisify(execFile);

/**
 * Supported release compilation target matrix.
 */
export type ReleaseTarget =
  "linux-x64" | "linux-arm64" | "android-arm64" | "darwin-x64" | "darwin-arm64" | "windows-x64";

/**
 * Options supported by the `update` subcommand.
 */
export interface UpdateCommandOptions {
  /** Whether to only check for the latest release without installing. */
  readonly check?: boolean | undefined;
  /** Specific target version to install or roll back to (e.g. 0.1.1). */
  readonly version?: string | undefined;
}

/**
 * Detects the runtime host operating system and CPU architecture target.
 *
 * @returns Recognized release target identifier string.
 */
export function detectHostTarget(): ReleaseTarget {
  const platform = process.platform as string;
  const arch = process.arch === "arm64" ? "arm64" : "x64";

  if (platform === "darwin") {
    return `darwin-${arch}`;
  }

  if (platform === "win32") {
    return "windows-x64";
  }

  const isAndroid =
    platform === "android" ||
    process.env.TERMUX_VERSION !== undefined ||
    existsSync("/data/data/com.termux");

  if (isAndroid && arch === "arm64") {
    return "android-arm64";
  }

  if (platform === "linux") {
    return `linux-${arch}`;
  }

  throw new Error(`Unsupported operating system / architecture: ${platform}/${process.arch}`);
}

/**
 * Queries GitHub Releases API for the latest published release tag.
 *
 * @returns Clean semantic version string without leading 'v'.
 */
export async function fetchLatestVersion(): Promise<string> {
  const url = `https://api.github.com/repos/${gregGitHubRepo}/releases/latest`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": `greg/${gregVersion}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch latest release from GitHub (HTTP ${response.status}: ${response.statusText})`,
    );
  }

  const payload = (await response.json()) as { tag_name?: string };
  if (!payload.tag_name || typeof payload.tag_name !== "string") {
    throw new Error("Invalid GitHub release payload: missing tag_name");
  }

  return payload.tag_name.replace(/^v/, "").trim();
}

/**
 * Fetches SHA256SUMS.txt from the release assets and verifies the downloaded archive checksum.
 *
 * @param targetVersion - The release version tag being installed.
 * @param archiveFilename - The exact filename of the release archive.
 * @param archiveBuffer - The in-memory buffer of the downloaded archive.
 */
export async function verifyArchiveChecksum(
  targetVersion: string,
  archiveFilename: string,
  archiveBuffer: Buffer,
): Promise<void> {
  const checksumsUrl = `https://github.com/${gregGitHubRepo}/releases/download/v${targetVersion}/SHA256SUMS.txt`;
  const response = await fetch(checksumsUrl, {
    headers: {
      "User-Agent": `greg/${gregVersion}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch release SHA256SUMS.txt (HTTP ${response.status})`);
  }

  const checksumsText = await response.text();
  const lines = checksumsText.split(/\r?\n/);

  let expectedHash: string | undefined;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && parts[1]?.replace(/^\*/, "") === archiveFilename) {
      expectedHash = parts[0]?.toLowerCase();
      break;
    }
  }

  if (!expectedHash) {
    throw new Error(`Checksum for "${archiveFilename}" not found in SHA256SUMS.txt`);
  }

  const actualHash = createHash("sha256").update(archiveBuffer).digest("hex").toLowerCase();
  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum verification failed for ${archiveFilename} (expected ${expectedHash}, got ${actualHash})`,
    );
  }

  writeToStdout(
    `${brandColors.muted}Verified checksum: ${brandColors.reset}sha256:${actualHash.slice(0, 8)}...\n`,
  );
}

/**
 * Updates internal and environment symlinks to point to the specified binary path.
 *
 * @param binDir - Target bin directory containing the internal symlink.
 * @param binaryName - Name of the binary (e.g. "greg" or "greg.exe").
 * @param installedBinaryPath - Absolute path to the versioned executable binary.
 */
export async function updateSymlinks(
  binDir: string,
  binaryName: string,
  installedBinaryPath: string,
): Promise<void> {
  const activeInternalSymlink = path.join(binDir, binaryName);
  try {
    await unlink(activeInternalSymlink);
  } catch {
    // Symlink may not exist yet
  }
  await symlink(installedBinaryPath, activeInternalSymlink);

  if (process.env.PREFIX) {
    const termuxSymlink = path.join(process.env.PREFIX, "bin", binaryName);
    try {
      await unlink(termuxSymlink);
    } catch {
      // Symlink may not exist yet
    }
    try {
      await symlink(activeInternalSymlink, termuxSymlink);
    } catch {
      // Best-effort prefix symlink update
    }
  }
}

/**
 * Executes the `update` subcommand flow.
 *
 * @param options - Parsed update options.
 */
export async function executeUpdateAction(options: UpdateCommandOptions): Promise<void> {
  const currentVersion = gregVersion;

  // 1. Check mode
  if (options.check) {
    try {
      const latestVersion = await fetchLatestVersion();
      if (latestVersion !== currentVersion) {
        writeToStdout(
          `${brandColors.muted}Update available: ${brandColors.reset}${currentVersion} ${brandColors.muted}→ ${brandColors.reset}${latestVersion}\n${brandColors.muted}Run ${brandColors.reset}greg update${brandColors.muted} to install.${brandColors.reset}\n`,
        );
      } else {
        writeToStdout(`${brandColors.muted}Up to date: ${brandColors.reset}${currentVersion}\n`);
      }
      return;
    } catch (checkErr) {
      writeToStderr(
        `${brandColors.red}Error: ${(checkErr as Error).message}${brandColors.reset}\n`,
      );
      process.exit(1);
    }
  }

  // 2. Resolve target version
  let targetVersion: string;
  if (options.version && options.version.trim().length > 0) {
    targetVersion = options.version.trim().replace(/^v/, "");
  } else {
    try {
      const latest = await fetchLatestVersion();
      targetVersion = latest;
    } catch (resolveErr) {
      writeToStderr(
        `${brandColors.red}Error: ${(resolveErr as Error).message}${brandColors.reset}\n`,
      );
      process.exit(1);
    }
  }

  // 3. Detect host platform target
  let target: ReleaseTarget;
  try {
    target = detectHostTarget();
  } catch (detectErr) {
    writeToStderr(`${brandColors.red}Error: ${(detectErr as Error).message}${brandColors.reset}\n`);
    process.exit(1);
  }

  const isWindows = target.startsWith("windows");
  const ext = isWindows ? ".zip" : ".tar.gz";
  const binaryName = isWindows ? "greg.exe" : "greg";

  const homeDir = resolveHomeDirectory();
  const binDir = path.join(homeDir, "bin");
  const targetVersionDir = path.join(binDir, targetVersion);
  const installedBinaryPath = path.join(targetVersionDir, binaryName);

  // If target version binary is already installed, update symlink and exit
  if (existsSync(installedBinaryPath)) {
    await updateSymlinks(binDir, binaryName, installedBinaryPath);
    if (targetVersion === currentVersion && !options.version) {
      writeToStdout(
        `${brandColors.muted}Already on latest version: ${brandColors.reset}${currentVersion}\n`,
      );
    } else {
      writeToStdout(
        `${brandColors.muted}Version ${brandColors.reset}${targetVersion} ${brandColors.muted}is already installed, updated symlink${brandColors.reset}\n`,
      );
    }
    return;
  }

  const archiveFilename = `greg-v${targetVersion}-${target}${ext}`;
  const downloadUrl = `https://github.com/${gregGitHubRepo}/releases/download/v${targetVersion}/${archiveFilename}`;

  writeToStdout(
    `${brandColors.muted}Downloading ${brandColors.reset}v${targetVersion} ${brandColors.muted}(${target})...${brandColors.reset}\n`,
  );

  const tempDir = await rm(path.join(os.tmpdir(), `greg-update-${Date.now()}`), {
    recursive: true,
    force: true,
  }).then(async () => {
    const dir = path.join(os.tmpdir(), `greg-update-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    return dir;
  });

  const archivePath = path.join(tempDir, archiveFilename);

  try {
    const downloadResponse = await fetch(downloadUrl);
    if (!downloadResponse.ok) {
      if (downloadResponse.status === 404) {
        throw new Error(
          `Version "${targetVersion}" is not available for target "${target}". Visit https://github.com/${gregGitHubRepo}/releases`,
        );
      }
      throw new Error(
        `Failed to download release archive (HTTP ${downloadResponse.status}: ${downloadResponse.statusText})`,
      );
    }

    const arrayBuffer = await downloadResponse.arrayBuffer();
    const archiveBuffer = Buffer.from(arrayBuffer);

    // Verify SHA-256 checksum from release SHA256SUMS.txt
    await verifyArchiveChecksum(targetVersion, archiveFilename, archiveBuffer);

    await writeFile(archivePath, archiveBuffer);

    // Extract archive
    if (isWindows) {
      await execFileAsync("tar", ["-xf", archivePath, "-C", tempDir]);
    } else {
      await execFileAsync("tar", ["-xzf", archivePath, "-C", tempDir]);
    }

    const extractedBinaryPath = path.join(tempDir, binaryName);
    if (!existsSync(extractedBinaryPath)) {
      throw new Error(`Extracted archive did not contain binary "${binaryName}"`);
    }

    // Save binary to versioned target directory HERNEX_HOME/bin/<version>/
    await mkdir(targetVersionDir, { recursive: true });
    await copyFile(extractedBinaryPath, installedBinaryPath);
    await chmod(installedBinaryPath, 0o755);

    // Update active symlinks without pruning older versions
    await updateSymlinks(binDir, binaryName, installedBinaryPath);

    writeToStdout(`${brandColors.muted}Installed version: ${brandColors.reset}${targetVersion}\n`);
  } catch (err) {
    writeToStderr(`${brandColors.red}Error: ${(err as Error).message}${brandColors.reset}\n`);
    process.exit(1);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Creates the commander Command for the `update` subcommand.
 *
 * @returns Fully configured commander Command instance for `update`.
 *
 * @example
 * ```typescript
 * const updateCmd = createUpdateCommand();
 * program.addCommand(updateCmd);
 * ```
 */
export function createUpdateCommand(): Command {
  const update = new Command("update")
    .description("Update greg to the latest or a specified version")
    .option("-c, --check", "Check for the latest available version without installing")
    .option("-v, --version <version>", "Specific version to install (e.g. 0.1.1)")
    .action(async (options: UpdateCommandOptions) => {
      await executeUpdateAction(options);
    });

  return update;
}
