#!/usr/bin/env bash
set -euo pipefail

APP=greg
REPO="amaranthic/greg"

MUTED='\033[0;2m'
RED='\033[0;31m'
ORANGE='\033[38;5;214m'
NC='\033[0m'

usage() {
    cat <<EOF
greg Installer

Usage: install.sh [options]

Options:
    -h, --help              Display this help message
    -v, --version <version> Install a specific version (e.g., 0.1.9)
    -c, --check             Check installed version against latest release
    -b, --bare              Download binary to current directory only (no moving, no PATH changes)
        --binary <path>     Install from a local binary instead of downloading
        --no-modify-path    Don't modify shell config files (.zshrc, .bashrc, etc.)

Examples:
    curl -fsSL https://raw.githubusercontent.com/${REPO}/main/installer/install.sh | bash
    curl -fsSL https://raw.githubusercontent.com/${REPO}/main/installer/install.sh | bash -s -- --version 0.1.9
    curl -fsSL https://raw.githubusercontent.com/${REPO}/main/installer/install.sh | bash -s -- --bare
    ./install.sh --check
EOF
}

requested_version=${VERSION:-}
check_only=false
bare_mode=false
no_modify_path=false
binary_path=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -v|--version)
            if [[ -n "${2:-}" && ! "$2" =~ ^- ]]; then
                requested_version="$2"
                shift 2
            else
                echo -e "${RED}Error: --version requires a version argument${NC}"
                exit 1
            fi
            ;;
        -c|--check)
            check_only=true
            shift
            ;;
        -b|--bare)
            bare_mode=true
            shift
            ;;
        --binary)
            if [[ -n "${2:-}" && ! "$2" =~ ^- ]]; then
                binary_path="$2"
                shift 2
            else
                echo -e "${RED}Error: --binary requires a path argument${NC}"
                exit 1
            fi
            ;;
        --no-modify-path)
            no_modify_path=true
            shift
            ;;
        *)
            echo -e "${ORANGE}Warning: Unknown option '$1'${NC}" >&2
            shift
            ;;
    esac
done

print_message() {
    local level=$1
    local message=$2
    local color=""

    case $level in
        info) color="${NC}" ;;
        warning) color="${NC}" ;;
        error) color="${RED}" ;;
    esac

    echo -e "${color}${message}${NC}"
}

check_version() {
    if command -v "$APP" >/dev/null 2>&1; then
        installed_version=$("$APP" --version 2>/dev/null || echo "")
        installed_version="${installed_version##* }"
        installed_version="${installed_version#v}"

        print_message info "${MUTED}Installed version: ${NC}$installed_version"
    fi
}

get_latest_version() {
    local tag=""
    tag=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null | grep '"tag_name":' | head -n 1 | sed -E 's/.*"tag_name": *"v?([^"]+)".*/\1/' || true)
    if [ -z "$tag" ]; then
        local latest_url=""
        latest_url=$(curl -fsSLI -o /dev/null -w "%{url_effective}" "https://github.com/${REPO}/releases/latest" 2>/dev/null || true)
        tag="${latest_url##*/}"
        tag="${tag#v}"
    fi
    echo "$tag"
}

# Handle --check
if [ "$check_only" = true ]; then
    check_version
    latest=$(get_latest_version)
    print_message info "${MUTED}Latest version:    ${NC}${latest:-unknown}"
    exit 0
fi

# Detect platform
raw_os=$(uname -s)
os=$(echo "$raw_os" | tr '[:upper:]' '[:lower:]')
case "$raw_os" in
  Darwin*) os="darwin" ;;
  Linux*) os="linux" ;;
  MINGW*|MSYS*|CYGWIN*) os="windows" ;;
esac

arch=$(uname -m)
if [[ "$arch" == "aarch64" || "$arch" == "arm64" ]]; then
  arch="arm64"
fi
if [[ "$arch" == "x86_64" || "$arch" == "amd64" ]]; then
  arch="x64"
fi

if [ "$os" = "darwin" ] && [ "$arch" = "x64" ]; then
  rosetta_flag=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
  if [ "$rosetta_flag" = "1" ]; then
    arch="arm64"
  fi
fi

if [ "$os" = "windows" ] && [ "$arch" = "x64" ]; then
  if [[ "$raw_os" == *-ARM64 || "${PROCESSOR_IDENTIFIER:-}" == ARM* ]]; then
    arch="arm64"
  fi
fi

is_android=false
if [ "$os" = "linux" ]; then
  if [ -n "${TERMUX_VERSION:-}" ] || [ -d "/data/data/com.termux" ] || [ "$(uname -o 2>/dev/null)" = "Android" ]; then
    is_android=true
  fi
fi

if [ "$is_android" = "true" ] && [ "$arch" = "arm64" ]; then
  target="android-arm64"
else
  target="$os-$arch"
fi

case "$target" in
  linux-x64|linux-arm64|android-arm64|darwin-x64|darwin-arm64|windows-x64)
    ;;
  *)
    echo -e "${RED}Unsupported OS/Arch: $os/$arch${NC}"
    exit 1
    ;;
esac

if [ "$os" = "windows" ]; then
  if ! command -v unzip >/dev/null 2>&1; then
    echo -e "${RED}Error: 'unzip' is required but not installed.${NC}"
    exit 1
  fi
else
  if ! command -v tar >/dev/null 2>&1; then
    echo -e "${RED}Error: 'tar' is required but not installed.${NC}"
    exit 1
  fi
fi

installed_binary="$APP"
if [[ "$os" == "windows" ]]; then
    installed_binary="$APP.exe"
fi

# Resolve version and URL
if [ -n "$binary_path" ]; then
    if [ ! -f "$binary_path" ]; then
        echo -e "${RED}Error: Binary not found at ${binary_path}${NC}"
        exit 1
    fi
    specific_version="local"
else
    if [ -z "$requested_version" ]; then
        specific_version=$(get_latest_version)
        if [ -z "$specific_version" ]; then
            echo -e "${RED}Failed to fetch version information${NC}"
            exit 1
        fi
    else
        requested_version="${requested_version#v}"
        specific_version="$requested_version"
    fi

    if [ "$os" = "windows" ]; then
        filename="greg-v${specific_version}-${target}.zip"
    else
        filename="greg-v${specific_version}-${target}.tar.gz"
    fi

    url="https://github.com/${REPO}/releases/download/v${specific_version}/${filename}"
    http_status=$(curl -s -o /dev/null -w "%{http_code}" -I "$url" || true)

    if [ "$http_status" = "404" ]; then
        echo -e "${RED}Error: Version ${specific_version} is not available for ${target}${NC}"
        echo -e "${MUTED}Available releases: https://github.com/${REPO}/releases${NC}"
        exit 1
    fi
    if [ "$http_status" != "200" ] && [ "$http_status" != "302" ]; then
        echo -e "${RED}Failed to fetch release package (${http_status})${NC}"
        exit 1
    fi
fi

print_progress() {
    local bytes="$1"
    local length="$2"
    [ "$length" -gt 0 ] || return 0

    local width=50
    local percent=$(( bytes * 100 / length ))
    [ "$percent" -gt 100 ] && percent=100
    local on=$(( percent * width / 100 ))
    local off=$(( width - on ))

    local filled=$(printf "%*s" "$on" "")
    filled=${filled// /▰}
    local empty=$(printf "%*s" "$off" "")
    empty=${empty// /▱}

    printf "\r${ORANGE}%s${MUTED}%s ${ORANGE}%3d%%${NC}" "$filled" "$empty" "$percent" >&4
}

download_with_progress() {
    local url="$1"
    local output="$2"

    if [ -t 2 ]; then
        exec 4>&2
    else
        exec 4>/dev/null
    fi

    local headers="${output}.headers"

    printf "\033[?25l" >&4

    trap "trap - RETURN; rm -f \"$headers\"; printf '\033[?25h' >&4; exec 4>&-" RETURN

    curl -fsL -D "$headers" -o "$output" "$url" &
    local curl_pid=$!

    local length bytes
    while kill -0 "$curl_pid" 2>/dev/null; do
        if [ -f "$output" ]; then
            length=$(grep -i '^content-length:' "$headers" 2>/dev/null | tail -n 1 | tr -dc '0-9' || true)
            bytes=$(ls -ln "$output" | awk '{print $5}')
            print_progress "$bytes" "${length:-0}"
        fi
        sleep 0.1 2>/dev/null || sleep 1
    done

    local ret=0
    wait "$curl_pid" || ret=$?
    if [ "$ret" -eq 0 ]; then
        bytes=$(ls -ln "$output" | awk '{print $5}')
        print_progress "$bytes" "$bytes"
    fi
    echo "" >&4
    return $ret
}

# Resolve target installation directory (HERNEX_HOME/bin or ~/.greg/bin)
if [ -n "${HERNEX_HOME:-}" ]; then
    greg_home="${HERNEX_HOME}"
else
    greg_home="${HOME}/.greg"
fi

if [[ "$greg_home" == "~"* ]]; then
    greg_home="${HOME}${greg_home#\~}"
fi

BIN_DIR="$greg_home/bin"

# Perform download/unpacking
check_version

tmp_dir="${TMPDIR:-/tmp}/greg_install_$$"
mkdir -p "$tmp_dir"
cleanup() {
    rm -rf "$tmp_dir"
}
trap cleanup EXIT

if [ -n "$binary_path" ]; then
    print_message info "\n${MUTED}Installing ${NC}$APP ${MUTED}from: ${NC}$binary_path"
    cp "$binary_path" "$tmp_dir/$installed_binary"
    chmod 755 "$tmp_dir/$installed_binary"
else
    print_message info "\n${MUTED}Installing ${NC}$APP ${MUTED}version: ${NC}$specific_version"

    if [[ "$os" == "windows" ]] || ! [ -t 2 ] || ! download_with_progress "$url" "$tmp_dir/$filename"; then
        local ret=0
        curl -f -# -L -o "$tmp_dir/$filename" "$url" || ret=$?
        if [ "$ret" -eq 23 ]; then
            print_message error "Could not write download to $tmp_dir. Make sure it has enough free space." >&2
        fi
        if [ "$ret" -ne 0 ]; then
            exit "$ret"
        fi
    fi

    if [[ "$os" == "windows" ]]; then
        unzip -q -o "$tmp_dir/$filename" -d "$tmp_dir"
    else
        tar -xzf "$tmp_dir/$filename" -C "$tmp_dir"
    fi
    chmod 755 "$tmp_dir/$installed_binary"
fi

# Handle --bare
if [ "$bare_mode" = true ]; then
    mv -f "$tmp_dir/$installed_binary" "./$installed_binary"
    print_message info "${MUTED}Placed ${NC}$installed_binary ${MUTED}in current directory.${NC}"
    exit 0
fi

# Direct installation into BIN_DIR (no version subdirectories, no symlinks)
mkdir -p "$BIN_DIR"
mv -f "$tmp_dir/$installed_binary" "$BIN_DIR/$installed_binary"
chmod 755 "$BIN_DIR/$installed_binary"

# Update PATH
path_added=false
add_to_path() {
    local config_file=$1
    local command=$2

    if grep -Fxq "$command" "$config_file" 2>/dev/null; then
        print_message info "Command already exists in $config_file, skipping write."
    elif [[ -w $config_file ]]; then
        echo -e "\n# greg" >> "$config_file"
        echo "$command" >> "$config_file"
        path_added=true
        print_message info "${MUTED}Successfully added ${NC}greg ${MUTED}to \$PATH in ${NC}$config_file"
    else
        print_message warning "Manually add directory to $config_file (or similar):"
        print_message info "  $command"
    fi
}

XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}

current_shell=$(basename "${SHELL:-bash}")
case $current_shell in
    fish)
        config_files="$HOME/.config/fish/config.fish"
    ;;
    zsh)
        config_files="${ZDOTDIR:-$HOME}/.zshrc ${ZDOTDIR:-$HOME}/.zshenv $XDG_CONFIG_HOME/zsh/.zshrc $XDG_CONFIG_HOME/zsh/.zshenv"
    ;;
    bash)
        config_files="$HOME/.bashrc $HOME/.bash_profile $HOME/.profile $XDG_CONFIG_HOME/bash/.bashrc $XDG_CONFIG_HOME/bash/.bash_profile"
    ;;
    ash|sh)
        config_files="$HOME/.ashrc $HOME/.profile /etc/profile"
    ;;
    *)
        config_files="$HOME/.bashrc $HOME/.bash_profile $XDG_CONFIG_HOME/bash/.bashrc $XDG_CONFIG_HOME/bash/.bash_profile"
    ;;
esac

already_in_path=false
if [[ ":$PATH:" == *":$BIN_DIR:"* ]]; then
    already_in_path=true
fi

if [[ "$no_modify_path" != "true" ]] && [[ "$already_in_path" != "true" ]]; then
    config_file=""
    for file in $config_files; do
        if [[ -f $file ]]; then
            config_file=$file
            break
        fi
    done

    if [[ -z $config_file ]]; then
        case $current_shell in
            zsh) new_config_file="${ZDOTDIR:-$HOME}/.zshrc" ;;
            fish) new_config_file="$HOME/.config/fish/config.fish" ;;
            *) new_config_file="" ;;
        esac
        if [[ -n $new_config_file ]] && mkdir -p "$(dirname "$new_config_file")" 2>/dev/null && touch "$new_config_file" 2>/dev/null; then
            config_file=$new_config_file
        fi
    fi

    if [[ -z $config_file ]]; then
        print_message warning "No config file found for $current_shell. You may need to manually add to PATH:"
        print_message info "  export PATH=$BIN_DIR:\$PATH"
    else
        case $current_shell in
            fish)
                add_to_path "$config_file" "fish_add_path $BIN_DIR"
            ;;
            *)
                add_to_path "$config_file" "export PATH=$BIN_DIR:\$PATH"
            ;;
        esac
    fi
fi

if [ -n "${GITHUB_ACTIONS-}" ] && [ "${GITHUB_ACTIONS}" == "true" ]; then
    echo "$BIN_DIR" >> "$GITHUB_PATH"
    print_message info "Added $BIN_DIR to \$GITHUB_PATH"
fi

echo -e ""
echo -e "${MUTED}The post-modern autonomous print agent, to start:${NC}"
echo -e ""
if [[ $path_added == "true" ]]; then
    echo -e "exec \$SHELL           ${MUTED}# Reload PATH (or open a new terminal)${NC}"
fi
echo -e "greg --help            ${MUTED}# Show help${NC}"
echo -e "greg \"Hello World\"     ${MUTED}# Run prompt${NC}"
echo -e ""
echo -e "${MUTED}For more information visit ${NC}https://github.com/${REPO}"
echo -e ""
