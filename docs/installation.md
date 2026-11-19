---
title: "Installation"
description: "Detailed installation instructions for macOS, Linux, Windows, WSL, and Android."
---

`greg` is distributed as a self-contained, standalone native binary with zero runtime dependencies. You do not need Node.js, Bun, or Python installed on your system to run the official releases.

---

## Supported Platforms

`greg` provides precompiled native release binaries for:

| Operating System | Architecture | Target String |
| :--- | :--- | :--- |
| **macOS** | Apple Silicon (M1/M2/M3/M4) | `darwin-arm64` |
| **macOS** | Intel x86_64 | `darwin-x64` |
| **Linux** | x86_64 (glibc / musl) | `linux-x64` |
| **Linux** | ARM64 (aarch64) | `linux-arm64` |
| **Windows** | x86_64 (Git Bash / MinGW / WSL) | `windows-x64` |
| **Android** | ARM64 via Termux | `android-arm64` |

---

## Method 1: Official Installer (Recommended)

The easiest way to install `greg` on macOS, Linux, or WSL is through the automated installation script.

```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash
```

### What the installer does:
1. Detects your operating system and CPU architecture.
2. Fetches the latest standalone release binary from GitHub.
3. Installs the executable into `~/.greg/bin/greg`.
4. Automatically updates your shell profile (`~/.zshrc`, `~/.bashrc`, or fish config) so `greg` is immediately available in your `PATH`.

### Installer Options

You can pass arguments to the installer using `bash -s -- [options]`:

#### Install a specific version
```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash -s -- --version 0.1.8
```

#### Install without modifying shell configuration
If you manage your `PATH` manually (e.g. via dotfiles):
```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash -s -- --no-modify-path
```

#### Install from a local prebuilt binary
```bash
./install.sh --binary /path/to/local/greg
```

---

## Method 2: Direct Release Download

If you prefer to download release assets manually without running a shell script:

1. Visit the [Official Releases Page](https://github.com/amaranthic/greg/releases/latest).
2. Download the archive matching your platform:
   * **macOS (Apple Silicon)**: `greg-darwin-arm64.tar.gz`
   * **macOS (Intel)**: `greg-darwin-x64.tar.gz`
   * **Linux (x64)**: `greg-linux-x64.tar.gz`
   * **Linux (ARM64)**: `greg-linux-arm64.tar.gz`
   * **Windows**: `greg-windows-x64.zip`
3. Extract the archive and place the `greg` binary into any directory in your `PATH`:
   ```bash
   tar -xzf greg-linux-x64.tar.gz
   chmod +x greg
   sudo mv greg /usr/local/bin/
   ```

---

## Method 3: Building from Source

If you want to build `greg` directly from source or contribute to development:

### Prerequisites
* [Bun](https://bun.sh) (`v1.2` or later)
* [Git](https://git-scm.com)

### Build Steps

```bash
# 1. Clone the repository
git clone https://github.com/amaranthic/greg.git
cd greg

# 2. Install dependencies
bun install

# 3. Compile the standalone native binary
bun run build
```

This compiles a self-contained, standalone executable named `./greg` in your root directory. You can test it immediately:

```bash
./greg --version
```

To install your locally compiled binary into your system `PATH`:
```bash
mv greg ~/.local/bin/
# Or use the installer:
./installer/install.sh --binary ./greg
```

---

## Verifying the Installation

Open a new terminal window and run:

```bash
greg --version
```

If the installation was successful, the command outputs the active version number.

---

## Managing Updates

`greg` includes a built-in self-updater that downloads and verifies new releases directly from GitHub:

### Check if a newer version is available
```bash
greg update --check
```

### Update to the latest release
```bash
greg update
```

### Roll back or pin to a specific version
```bash
greg update --version 0.1.0
```

---

## Troubleshooting

### `command not found: greg`

If running `greg` returns `command not found`, the installation directory (`~/.greg/bin`) is not yet in your shell's `PATH`.

Add the following line to your shell configuration file:

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

Then reload your shell:
```bash
source ~/.zshrc # or source ~/.bashrc
```

### Custom Storage & Config Location (`HERNEX_HOME`)

By default, `greg` stores its binary, threads, checkpoints, and settings inside `~/.greg`. You can customize this root directory by setting the `HERNEX_HOME` environment variable:

```bash
export HERNEX_HOME="/custom/storage/path"
```

---

## Uninstalling

To completely remove `greg` from your system:

```bash
# 1. Remove the binary and state directory
rm -rf ~/.greg

# 2. (Optional) Remove the PATH export line from your ~/.zshrc or ~/.bashrc
```
