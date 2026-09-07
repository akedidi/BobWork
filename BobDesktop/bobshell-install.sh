#!/bin/bash

# Parse command line arguments
PRESELECTED_PM=""
PRESELECTED_VERSION=""
while [[ $# -gt 0 ]]; do
    case $1 in
        --package-manager|--pm)
            PRESELECTED_PM="$2"
            shift 2
            ;;
        --version|-v)
            PRESELECTED_VERSION="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--package-manager|--pm <npm|pnpm|yarn>] [--version|-v <X.Y.Z>]"
            exit 1
            ;;
    esac
done

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Unicode symbols
CHECK_MARK="✓"
CROSS_MARK="✗"
ARROW="→"
PACKAGE="📦"
DOWNLOAD="⬇️"
INSTALL="🔧"

# Function to print colored messages
print_info() {
    echo -e "${BLUE}${ARROW}${NC} $1"
}

print_success() {
    echo -e "${GREEN}${CHECK_MARK}${NC} $1"
}

print_error() {
    echo -e "${RED}${CROSS_MARK}${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC}  $1"
}

print_header() {
    echo -e "\n${BOLD}${CYAN}$1${NC}\n"
}

# Spinner function for long-running operations
spinner() {
    local pid=$1
    local delay=0.1
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local temp

    while ps -p "$pid" > /dev/null 2>&1; do
        temp=${spinstr#?}
        printf " ${CYAN}%c${NC}  " "$spinstr"
        spinstr=$temp${spinstr%"$temp"}
        sleep $delay
        printf "\b\b\b\b\b"
    done
    printf "    \b\b\b\b"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check Node.js version
check_node_version() {
    print_header "Checking Node.js Installation"

    if ! command_exists node; then
        print_error "Node.js is not installed."
        echo -e "  ${YELLOW}Please install Node.js version 22.15 or higher and try again.${NC}"
        exit 1
    fi

    local node_version
    local required_version
    local min_version
    node_version=$(node -v | sed 's/v//')
    required_version="22.15.0"

    # Compare versions using sort -V
    min_version=$(printf '%s\n%s' "${required_version}" "${node_version}" | sort -V | head -n1)

    if [[ ${min_version} != "${required_version}" ]]; then
        print_error "Node.js version ${node_version} is installed, but version 22.15 or higher is required."
        echo -e "  ${YELLOW}Please upgrade Node.js and try again.${NC}"
        exit 1
    fi

    print_success "Node.js version ${BOLD}${node_version}${NC} detected (minimum 22.15 required)"
}

# Check Node.js version first
check_node_version

# Script to select a package manager (npm, pnpm, or yarn)
print_header "Package Manager Selection"
echo ""
if [[ -z "$PRESELECTED_PM" ]]; then
    print_info "Tip: You can skip this selection by using: ${BOLD}--package-manager${NC} or ${BOLD}--pm${NC} (e.g., --pm npm)"
fi

# Check which package managers are available
available_managers=()
options_text=""
option_num=1

if command_exists npm; then
    available_managers+=("npm")
    options_text+="  ${option_num}) ${BOLD}npm${NC}\n"
    option_num=$((option_num + 1))
fi

if command_exists pnpm; then
    available_managers+=("pnpm")
    options_text+="  ${option_num}) ${BOLD}pnpm${NC}\n"
    option_num=$((option_num + 1))
fi

if command_exists yarn; then
    available_managers+=("yarn")
    options_text+="  ${option_num}) ${BOLD}yarn${NC}\n"
    option_num=$((option_num + 1))
fi

# Check if no package managers are available
if [[ ${#available_managers[@]} -eq 0 ]]; then
    print_error "No supported package managers (npm, pnpm, or yarn) found on your system."
    echo -e "  ${YELLOW}Please install one of these package managers and try again.${NC}"
    exit 1
fi

# Handle preselected package manager
selected=""
if [[ -n "$PRESELECTED_PM" ]]; then
    # Validate that the preselected package manager is available
    found=false
    for manager in "${available_managers[@]}"; do
        if [[ "$manager" == "$PRESELECTED_PM" ]]; then
            found=true
            break
        fi
    done
    if [[ "$found" == "true" ]]; then
        selected="$PRESELECTED_PM"
        print_info "Using preselected package manager: ${BOLD}${selected}${NC}"
    else
        print_error "Preselected package manager '${PRESELECTED_PM}' is not available."
        echo -e "  ${YELLOW}Available options: ${available_managers[*]}${NC}"
        exit 1
    fi
# If only one package manager is available, select it automatically
elif [[ ${#available_managers[@]} -eq 1 ]]; then
    selected="${available_managers[0]}"
    print_info "Only ${BOLD}${selected}${NC} is available. Using it automatically."
else
    # Display available options
    echo -e "${CYAN}Available package managers:${NC}"
    echo -e "${options_text}"

    # Read user input
    while true; do
        read -r -p "$(echo -e "${BOLD}Enter your choice (1-${#available_managers[@]}):${NC} ")" choice < /dev/tty

        # Check if choice is a number and within range
        if [[ ${choice} =~ ^[0-9]+$ ]] && [[ ${choice} -ge 1 ]] && [[ ${choice} -le ${#available_managers[@]} ]]; then
            selected="${available_managers[$((choice-1))]}"
            print_success "Selected ${BOLD}${selected}${NC}"
            break
        else
            print_error "Invalid selection. Please enter a number between 1 and ${#available_managers[@]}."
        fi
    done
fi

echo ""
print_header "Downloading Bob Shell"

# Resolve version: use provided value or fetch from COS
if [[ -n "$PRESELECTED_VERSION" ]]; then
    if [[ ! "$PRESELECTED_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(\-[A-Za-z]+\.[0-9]+)?$ ]]; then
        print_error "Invalid version format '${PRESELECTED_VERSION}'. Expected format: X.Y.Z or X.Y.Z-tag (e.g. 1.0.5 or 2.0.0-rc.1)"
        exit 1
    fi
    version="$PRESELECTED_VERSION"
    print_info "Using specified version: ${BOLD}${version}${NC}"
else
    print_info "Fetching latest version..."
    version=$(curl -s https://s3.us-south.cloud-object-storage.appdomain.cloud/bob-shell/bobshell2-version.txt)

    if [[ -z "$version" ]]; then
        print_error "Failed to fetch Bob Shell version"
        exit 1
    fi

    print_success "Latest version: ${BOLD}${version}${NC}"
fi

dl_url="https://s3.us-south.cloud-object-storage.appdomain.cloud/bob-shell/bobshell-${version}.tgz"

echo ""
print_header "Verifying Package Integrity"

# Download SHA256 checksum
print_info "Fetching package checksum..."
checksum_url="https://s3.us-south.cloud-object-storage.appdomain.cloud/bob-shell/bobshell-${version}.tgz.sha256"
expected_sha256=$(curl -sL "${checksum_url}")

if [[ -z "$expected_sha256" ]]; then
    print_error "Failed to fetch package checksum from S3"
    exit 1
fi

print_success "Expected SHA256: ${BOLD}${expected_sha256}${NC}"

# Download tarball to temp location
print_info "Downloading package..."
temp_file="$(mktemp).tgz"
curl -sL "${dl_url}" -o "${temp_file}"

if [[ ! -f "${temp_file}" ]]; then
    print_error "Failed to download package"
    exit 1
fi

# Verify SHA256
print_info "Verifying integrity..."
if command -v sha256sum >/dev/null 2>&1; then
    actual_sha256=$(sha256sum "${temp_file}" | cut -d' ' -f1)
else
    actual_sha256=$(shasum -a 256 "${temp_file}" | cut -d' ' -f1)
fi

if [[ "$actual_sha256" != "$expected_sha256" ]]; then
    print_error "Integrity verification failed!"
    echo -e "  Expected: ${expected_sha256}"
    echo -e "  Got:      ${actual_sha256}"
    rm -f "${temp_file}"
    exit 1
fi

print_success "Package integrity verified"

echo ""
print_header "Installing Bob Shell"
print_info "Installing Bob Shell ${BOLD}${version}${NC} with ${BOLD}${selected}${NC}..."
echo ""

# Install with the selected package manager
install_success=false

# Function to show spinner during installation
show_spinner() {
    local pid=$1
    local delay=0.1
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

    while kill -0 "$pid" 2>/dev/null; do
        local temp=${spinstr#?}
        # Use echo -e to properly interpret color codes, then printf for positioning
        printf "\r ${CYAN}%s${NC}  Installing...   " "${spinstr:0:1}"
        spinstr=$temp${spinstr%"$temp"}
        sleep $delay
    done
    printf "\r                                        \r"
}

if [[ ${selected} == "pnpm" ]]; then
    temp_npmrc=$(mktemp)
    echo "registry=https://registry.npmjs.org/" > "${temp_npmrc}"
    NPM_CONFIG_USERCONFIG="${temp_npmrc}" PNPM_CONFIG_NPMRC_AUTH_FILE="${temp_npmrc}" pnpm add --registry=https://registry.npmjs.org/ --no-lockfile -g "${temp_file}" > /tmp/bobshell-install.log 2>&1 &
    show_spinner $!
    wait $!
    rm -f "${temp_npmrc}"
fi

if [[ ${selected} == "npm" ]]; then
    npm install --registry=https://registry.npmjs.org/ --progress=false --loglevel=error -g "${temp_file}" > /tmp/bobshell-install.log 2>&1 &
    show_spinner $!
    wait $!
fi

if [[ ${selected} == "yarn" ]]; then
    YARN_REGISTRY="https://registry.npmjs.org/" yarn global add --silent "${temp_file}" > /tmp/bobshell-install.log 2>&1 &
    show_spinner $!
    wait $!
fi

# Verify installation properly instead of relying on exit code
if command_exists bob; then
    installed_version=$(bob --version 2>/dev/null | head -n 1 | tr -d '[:space:]')
    if [[ "$installed_version" == "$version" ]]; then
        install_success=true
    else
        print_warning "Version mismatch: installed ${installed_version}, expected ${version}"
    fi
else
    print_warning "bob command not found after installation"
fi

echo ""
if [[ "$install_success" == true ]]; then
    print_header "Installation Complete! ${CHECK_MARK}"
    print_success "Bob Shell ${BOLD}${version}${NC} has been successfully installed"
    echo ""
    print_info "You can now run: ${BOLD}bob${NC}"
    echo ""

    # Telemetry Notice for External Users
    echo -e "${CYAN}Usage data is collected by default.${NC}"
    echo ""
    echo -e "${BLUE}${ARROW}${NC} To opt out, type ${BOLD}/settings${NC}, navigate to ${BOLD}Enable Usage Metrics${NC} and set the flag to ${BOLD}false${NC}"
    echo ""

    # Clean up log and temp files
    rm -f /tmp/bobshell-install.log
    rm -f "${temp_file}"
else
    print_error "Installation failed"
    echo ""

    # Show error logs if they exist
    if [[ -f /tmp/bobshell-install.log ]]; then
        error_content=$(cat /tmp/bobshell-install.log 2>/dev/null)
        if [[ -n "$error_content" ]]; then
            echo -e "${RED}Error details:${NC}"
            echo "$error_content"
        else
            echo -e "${YELLOW}No error details available in log file${NC}"
        fi
        # Clean up temp file
        rm -f "${temp_file}"
    else
        echo -e "${YELLOW}Log file not found${NC}"
    fi

    exit 1
fi

exit 0
