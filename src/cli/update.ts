/**
 * @fileoverview Subcommand for inspecting and updating the Greg binary to the latest or specific versions.
 * @packageDocumentation
 */

import { Command } from "commander";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { brandColors, gregGitHubRepo, gregVersion } from "../constants/index.js";
import { resolveHomeDirectory } from "../settings/index.js";
import { writeToStderr, writeToStdout } from "../utils/index.js";

const execFileAsync = promisify(execFile);

/** Supported release compilation targets. */
export type ReleaseTarget =
  "linux-x64" | "linux-arm64" | "android-arm64" | "darwin-x64" | "darwin-arm64" | "windows-x64";

/** Options accepted by the update command. */
export interface UpdateCommandOptions {
  /** Check installed version against latest release without installing. */
  readonly check?: boolean | undefined;
  /** Download binary to current directory only (no moving, no PATH changes). */
  readonly bare?: boolean | undefined;
  /** Specific target version to install (e.g. 0.1.10). */
  readonly version?: string | undefined;
}

/**
 * Detects the host operating system and CPU architecture target.
 *
 * @returns Supported release target identifier string.
 */
export function detectHostTarget(): ReleaseTarget {
  const platform = process.platform;
  const arch = process.arch === "arm64" ? "arm64" : "x64";

  if (platform === "darwin") return `darwin-${arch}`;
  if (platform === "win32") return "windows-x64";
  if (platform === "android" || Boolean(process.env.TERMUX_VERSION)) return "android-arm64";
  if (platform === "linux") return `linux-${arch}`;

  throw new Error(`Unsupported OS/Architecture: ${platform}/${process.arch}`);
}

/**
 * Queries GitHub for the latest published release tag.
 *
 * @returns Clean semantic version string without leading 'v'.
 */
export async function fetchLatestVersion(): Promise<string> {
  const apiUrl = `https://api.github.com/repos/${gregGitHubRepo}/releases/latest`;
  const res = await fetch(apiUrl, {
    headers: { "User-Agent": `greg/${gregVersion}`, Accept: "application/vnd.github.v3+json" },
  }).catch(() => null);

  if (res?.ok) {
    const json = (await res.json()) as { tag_name?: string };
    if (json.tag_name) return json.tag_name.replace(/^v/, "").trim();
  }

  // Fallback to HTTP redirect location
  const redirectRes = await fetch(`https://github.com/${gregGitHubRepo}/releases/latest`, {
    redirect: "manual",
  });
  const location = redirectRes.headers.get("location") ?? "";
  const tag = location.split("/").pop()?.replace(/^v/, "").trim();
  if (tag) return tag;

  throw new Error("Unable to fetch latest release version from GitHub");
}

/**
 * Renders the terminal progress bar matching the installer styling.
 *
 * @param bytes - Received bytes.
 * @param total - Total expected bytes.
 */
function renderProgressBar(bytes: number, total: number): void {
  if (total <= 0) return;
  const percent = Math.min(100, Math.floor((bytes * 100) / total));
  const width = 50;
  const on = Math.floor((percent * width) / 100);
  const off = width - on;
  const filled = "▰".repeat(on);
  const empty = "▱".repeat(off);
  process.stderr.write(
    `\r${brandColors.orange}${filled}${brandColors.muted}${empty} ${brandColors.orange}${String(percent).padStart(3)}%${brandColors.reset}`,
  );
}

/**
 * Downloads a release archive with progress indicator.
 *
 * @param url - Asset download URL.
 * @returns In-memory Buffer of the downloaded asset.
 */
async function downloadArchiveWithProgress(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error("Release asset not found for this platform target");
    }
    throw new Error(`Download failed with HTTP status ${res.status}`);
  }

  const contentLength = Number(res.headers.get("content-length") || 0);
  const reader = res.body?.getReader();
  if (!reader) {
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  const isTTY = Boolean(process.stderr.isTTY);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      if (contentLength > 0 && isTTY) {
        renderProgressBar(received, contentLength);
      }
    }
  }

  if (contentLength > 0 && isTTY) {
    renderProgressBar(contentLength, contentLength);
    process.stderr.write("\n");
  }

  return Buffer.concat(chunks);
}

/**
 * Atomically replaces a target executable to avoid ETXTBSY errors on running binaries.
 *
 * @param sourcePath - Path to the newly extracted binary file.
 * @param destinationPath - Path to the final executable destination.
 */
async function replaceBinaryAtomically(sourcePath: string, destinationPath: string): Promise<void> {
  const destinationDir = path.dirname(destinationPath);
  const stagingPath = path.join(
    destinationDir,
    `.${path.basename(destinationPath)}.tmp.${Date.now()}`,
  );

  await copyFile(sourcePath, stagingPath);
  await chmod(stagingPath, 0o755);

  try {
    await rename(stagingPath, destinationPath);
  } catch {
    await rm(destinationPath, { force: true }).catch(() => {});
    await rename(stagingPath, destinationPath);
  }
}

/**
 * Executes the `update` subcommand workflow.
 *
 * @param options - Parsed command options.
 */
export async function executeUpdateAction(options: UpdateCommandOptions): Promise<void> {
  const currentVersion = gregVersion;

  // 1. Check mode
  if (options.check) {
    try {
      writeToStdout(
        `${brandColors.muted}Installed version: ${brandColors.reset}${currentVersion}\n`,
      );
      const latest = await fetchLatestVersion();
      writeToStdout(`${brandColors.muted}Latest version:    ${brandColors.reset}${latest}\n`);
      return;
    } catch (err) {
      writeToStderr(`${brandColors.red}Error: ${(err as Error).message}${brandColors.reset}\n`);
      process.exit(1);
    }
  }

  // 2. Resolve target version
  let targetVersion = options.version?.trim().replace(/^v/, "");
  if (!targetVersion) {
    try {
      targetVersion = await fetchLatestVersion();
    } catch (err) {
      writeToStderr(`${brandColors.red}Error: ${(err as Error).message}${brandColors.reset}\n`);
      process.exit(1);
    }
  }

  // 3. Platform detection and asset resolution
  let target: ReleaseTarget;
  try {
    target = detectHostTarget();
  } catch (err) {
    writeToStderr(`${brandColors.red}Error: ${(err as Error).message}${brandColors.reset}\n`);
    process.exit(1);
  }

  const isWindows = target.startsWith("windows");
  const ext = isWindows ? ".zip" : ".tar.gz";
  const binaryName = isWindows ? "greg.exe" : "greg";
  const assetName = `greg-v${targetVersion}-${target}${ext}`;
  const downloadUrl = `https://github.com/${gregGitHubRepo}/releases/download/v${targetVersion}/${assetName}`;

  writeToStdout(`${brandColors.muted}Installed version: ${brandColors.reset}${currentVersion}\n`);
  writeToStdout(
    `\n${brandColors.muted}Installing ${brandColors.reset}greg ${brandColors.muted}version: ${brandColors.reset}${targetVersion}\n`,
  );

  // 4. Download and extract directly to HERNEX_HOME/bin/greg
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "greg-update-"));
  const archivePath = path.join(tempDir, assetName);

  try {
    const archiveBuffer = await downloadArchiveWithProgress(downloadUrl);
    await writeFile(archivePath, archiveBuffer);

    if (isWindows) {
      await execFileAsync("unzip", ["-q", "-o", archivePath, "-d", tempDir]);
    } else {
      await execFileAsync("tar", ["-xzf", archivePath, "-C", tempDir]);
    }

    const extractedBin = path.join(tempDir, binaryName);
    if (!existsSync(extractedBin)) {
      throw new Error(`Extracted archive did not contain "${binaryName}"`);
    }

    // Handle --bare: place binary in current directory
    if (options.bare) {
      const destPath = path.resolve(process.cwd(), binaryName);
      await replaceBinaryAtomically(extractedBin, destPath);
      writeToStdout(
        `${brandColors.muted}Placed ${brandColors.reset}${binaryName} ${brandColors.muted}in current directory.${brandColors.reset}\n`,
      );
      return;
    }

    const homeDir = resolveHomeDirectory();
    const binDir = path.join(homeDir, "bin");
    await mkdir(binDir, { recursive: true });

    const targetBin = path.join(binDir, binaryName);
    await replaceBinaryAtomically(extractedBin, targetBin);

    // 5. Success summary banner matching installer
    writeToStdout(
      `\n${brandColors.muted}The post-modern autonomous print agent, to start:${brandColors.reset}\n\n`,
    );
    writeToStdout(`greg --help            ${brandColors.muted}# Show help${brandColors.reset}\n`);
    writeToStdout(
      `greg "Hello World"     ${brandColors.muted}# Run prompt${brandColors.reset}\n\n`,
    );
    writeToStdout(
      `${brandColors.muted}For more information visit ${brandColors.reset}https://github.com/${gregGitHubRepo}\n\n`,
    );
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
 * @returns Configured commander Command instance for `update`.
 */
export function createUpdateCommand(): Command {
  return new Command("update")
    .description("Update greg to the latest or a specified version")
    .option("-c, --check", "Check for the latest available version without installing")
    .option("-b, --bare", "Download binary to current directory only (no moving, no PATH changes)")
    .option("-v, --version <version>", "Specific version to install (e.g. 0.1.10)")
    .action(async (options: UpdateCommandOptions) => {
      await executeUpdateAction(options);
    });
}
