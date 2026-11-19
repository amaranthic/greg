---
title: "Installation"
description: "Detailed installation instructions for macOS, Linux, Windows, WSL, and Android Termux."
---

`greg` is distributed as a self-contained, standalone native executable with zero external runtime dependencies. You do not need Node.js, Bun, or Python installed on your system to run official releases.

<Note>
Looking for a quick hands-on tutorial after installation? Check out the [Quickstart](/quickstart) to complete your first autonomous task in under two minutes.
</Note>

This page covers:

* [Supported Platforms](#supported-platforms): Operating systems and CPU architectures.
* [Method 1: Automated Installer (Recommended)](#method-1-automated-installer-recommended): Quick installation script and customizable flags.
* [Method 2: Direct Release Downloads](#method-2-direct-release-downloads): Manual tarball downloads for air-gapped or customized environments.
* [Method 3: Building from Source](#method-3-building-from-source): Compiling the standalone binary using Bun.
* [Verifying the Installation](#verifying-the-installation): Confirming your setup and active version.
* [Managing Updates](#managing-updates): Checking for releases, upgrading, and pinning specific versions.
* [Custom Storage & Config (`HERNEX_HOME`)](#custom-storage-config-hernex_home): Overriding the default `~/.greg` state directory.
* [Troubleshooting & PATH Setup](#troubleshooting-path-setup): Resolving `command not found: greg` across Zsh, Bash, and Fish.
* [Uninstalling](#uninstalling): Completely removing the binary and runtime state.
* [Next Steps](#next-steps): Next guides to explore.

---

## Supported Platforms

`greg` provides precompiled, statically linked standalone binaries for all modern desktop and server platforms:

| Operating System | Architecture | Target Platform String |
| :--- | :--- | :--- |
| **macOS** | Apple Silicon (M1/M2/M3/M4) | `darwin-arm64` |
| **macOS** | Intel x86_64 | `darwin-x64` |
| **Linux** | x86_64 (glibc / musl) | `linux-x64` |
| **Linux** | ARM64 (aarch64) | `linux-arm64` |
| **Windows** | x86_64 (Git Bash / MinGW / WSL) | `windows-x64` |
| **Android** | ARM64 via Termux | `android-arm64` |

---

## Method 1: Automated Installer (Recommended)

The fastest and most reliable way to install `greg` on macOS, Linux, or Windows (WSL) is using the official automated installer:

```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash
```

### What the Installer Does

1. **Architecture Detection**: Determines your host OS (`Darwin`, `Linux`, `Msys`) and CPU architecture (`arm64`, `x86_64`).
2. **Release Ingestion**: Downloads the latest release binary from the GitHub repository.
3. **Binary Placement**: Installs the standalone executable into `~/.greg/bin/greg` with correct executable permissions (`chmod +x`).
4. **Shell Configuration**: Automatically inspects your active shell profile (`~/.zshrc`, `~/.bashrc`, or fish configuration) and appends `~/.greg/bin` to your `PATH` if not already present.

### Customizing Installer Execution

You can customize the installation by passing arguments through `bash -s -- [options]`:

#### 1. Pin a Specific Version
Install an exact version of `greg` rather than latest:

```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash -s -- --version 0.1.8
```

#### 2. Prevent Modifying Shell Profiles
If you manage your `PATH` manually (e.g. through dotfiles or Nix):

```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash -s -- --no-modify-path
```

#### 3. Install from a Local Binary
Install a binary you built locally without downloading from GitHub:

```bash
./install.sh --binary /path/to/local/greg
```

---

## Method 2: Direct Release Downloads

For air-gapped environments, CI runners, or manual deployments, download official release archives directly:

#### 1. Download the Platform Archive
Visit the [Official Releases Page](https://github.com/amaranthic/greg/releases/latest) and download the appropriate asset:
* **macOS (Apple Silicon)**: `greg-darwin-arm64.tar.gz`
* **macOS (Intel)**: `greg-darwin-x64.tar.gz`
* **Linux (x64)**: `greg-linux-x64.tar.gz`
* **Linux (ARM64)**: `greg-linux-arm64.tar.gz`
* **Windows**: `greg-windows-x64.zip`

#### 2. Extract and Move to System PATH
Extract the archive and move the binary to any directory within your system `PATH`:

```bash
# Example for Linux x64
tar -xzf greg-linux-x64.tar.gz
chmod +x greg
sudo mv greg /usr/local/bin/
```

---

## Method 3: Building from Source

To compile `greg` from source or contribute to its development:

### Prerequisites

* [Bun](https://bun.sh) (`v1.2` or later)
* [Git](https://git-scm.com)

### Compilation Steps

```bash
# 1. Clone the repository
git clone https://github.com/amaranthic/greg.git
cd greg

# 2. Install dependencies
bun install

# 3. Compile the standalone native binary
bun run build
```

This compiles a self-contained native executable `./greg` in the repository root. You can test it immediately:

```bash
./greg --version
```

To install the compiled binary into your user `PATH`:

```bash
# Option A: Move directly to user bin
mv greg ~/.local/bin/

# Option B: Run the installer script against your compiled binary
./installer/install.sh --binary ./greg
```

---

## Verifying the Installation

Open a fresh terminal window and run:

```bash
greg --version
```

If the installation succeeded, `greg` prints its version number (e.g. `greg 0.1.8`).

Next, run a quick dry-run check:

```bash
greg --help
```

---

## Managing Updates

`greg` includes a built-in self-updater that verifies and updates the binary in-place:

### Check for Updates
Inspect if a newer release is available on GitHub:

```bash
greg update --check
```

### Upgrade to the Latest Release
Download and apply the latest release:

```bash
greg update
```

### Pin or Roll Back to a Specific Version
Install an exact historical release:

```bash
greg update --version 0.1.0
```

---

## Custom Storage & Config (`HERNEX_HOME`)

By default, `greg` stores its binary, persistent thread transcripts, pre-mutation snapshots, and settings under `~/.greg`.

To redirect this directory to an alternate drive, volume, or shared path, set the `HERNEX_HOME` environment variable in your shell profile:

```bash
export HERNEX_HOME="/custom/storage/path/greg"
```

When set, `greg` saves all threads in `$HERNEX_HOME/threads`, checkpoints in `$HERNEX_HOME/checkpoints`, and settings in `$HERNEX_HOME/settings.json`.

---

## Troubleshooting & PATH Setup

### Error: `command not found: greg`

If running `greg` returns `command not found`, your shell has not loaded the `~/.greg/bin` directory into its `PATH`.

Add the path export to your corresponding shell configuration file:

<CodeGroup>
```bash zsh (~/.zshrc)
export PATH="$HOME/.greg/bin:$PATH"
```

```bash bash (~/.bashrc)
export PATH="$HOME/.greg/bin:$PATH"
```

```bash fish (~/.config/fish/config.fish)
fish_add_path ~/.greg/bin
```
</CodeGroup>

Then reload your shell configuration:

```bash
# For Zsh
source ~/.zshrc

# For Bash
source ~/.bashrc
```

---

## Uninstalling

To cleanly uninstall `greg` and remove all local data:

```bash
# 1. Remove the binary, settings, threads, and checkpoints
rm -rf ~/.greg

# 2. (Optional) Remove the export PATH line from your ~/.zshrc or ~/.bashrc
```

---

## Next Steps

Now that your installation is complete and verified:

* [Quickstart](/quickstart): Complete your first autonomous task in under two minutes.
* [Managing Providers](/model-providers): Configure your API keys for Claude, Gemini, GPT-5, DeepSeek, or local gateways.
* [Common Workflows](/common-workflows): Explore real-world step-by-step developer recipes.
* [Managing Threads](/threads): Understand persistent threads, checkpoints, and time-travel rollback workflows.
