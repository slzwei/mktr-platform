#!/bin/bash

################################################################################
# Stress Test - Lead Generation Wrapper Script
#
# Provides a user-friendly interface for stress testing the lead capture system.
#
# Usage:
#   ./stress-test.sh <command> [options]
#
# Commands:
#   run <count>     Generate test leads (default: 500)
#   preview         Preview test data without deleting
#   cleanup         Delete all test leads (requires confirmation)
#   help            Show this help message
#
# Examples:
#   ./stress-test.sh run 1000        # Generate 1000 test leads
#   ./stress-test.sh preview         # Preview test data
#   ./stress-test.sh cleanup         # Clean up test data
################################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

################################################################################
# Functions
################################################################################

print_header() {
    echo -e "${CYAN}"
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║       MKTR Platform - Lead Stress Testing System          ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_help() {
    print_header
    echo "Usage: ./stress-test.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  ${GREEN}run <count> [batchSize]${NC}  Generate test leads"
    echo "                             • count: Number of leads (default: 500)"
    echo "                             • batchSize: Batch size (default: 50)"
    echo ""
    echo "  ${YELLOW}preview${NC}                  Preview test data to be cleaned"
    echo "                             • Safe dry-run mode"
    echo "                             • Shows what will be deleted"
    echo ""
    echo "  ${RED}cleanup${NC}                  Delete all test leads"
    echo "                             • Requires confirmation"
    echo "                             • Removes all STRESS_TEST tagged data"
    echo ""
    echo "  ${BLUE}help${NC}                     Show this help message"
    echo ""
    echo "Examples:"
    echo "  ./stress-test.sh run 1000         # Generate 1000 test leads"
    echo "  ./stress-test.sh run 2000 100     # Generate 2000 leads, 100/batch"
    echo "  ./stress-test.sh preview          # Preview test data"
    echo "  ./stress-test.sh cleanup          # Clean up test data"
    echo ""
    echo "Workflow:"
    echo "  1. Generate test data:   ${GREEN}./stress-test.sh run 1000${NC}"
    echo "  2. Test your features:   (Use the admin dashboard, API, etc.)"
    echo "  3. Preview cleanup:      ${YELLOW}./stress-test.sh preview${NC}"
    echo "  4. Clean up:             ${RED}./stress-test.sh cleanup${NC}"
    echo ""
}

check_node() {
    if ! command -v node &> /dev/null; then
        echo -e "${RED}❌ Error: Node.js is not installed${NC}"
        echo "Please install Node.js 18+ to continue"
        exit 1
    fi
}

check_scripts() {
    if [ ! -f "$SCRIPT_DIR/stress-test-leads.js" ]; then
        echo -e "${RED}❌ Error: stress-test-leads.js not found${NC}"
        exit 1
    fi
    if [ ! -f "$SCRIPT_DIR/cleanup-test-leads.js" ]; then
        echo -e "${RED}❌ Error: cleanup-test-leads.js not found${NC}"
        exit 1
    fi
}

run_generation() {
    local count=${1:-500}
    local batch_size=${2:-50}
    
    print_header
    echo -e "${GREEN}📊 Generating $count test leads...${NC}"
    echo ""
    
    cd "$SCRIPT_DIR"
    node stress-test-leads.js "$count" "$batch_size"
}

run_preview() {
    print_header
    echo -e "${YELLOW}🔍 Previewing test data...${NC}"
    echo ""
    
    cd "$SCRIPT_DIR"
    node cleanup-test-leads.js
}

run_cleanup() {
    print_header
    echo -e "${RED}🗑️  Cleaning up test data...${NC}"
    echo ""
    
    cd "$SCRIPT_DIR"
    node cleanup-test-leads.js --confirm
}

################################################################################
# Main
################################################################################

# Check prerequisites
check_node
check_scripts

# Parse command
COMMAND=${1:-help}

case "$COMMAND" in
    run)
        COUNT=${2:-500}
        BATCH_SIZE=${3:-50}
        
        # Validate count
        if ! [[ "$COUNT" =~ ^[0-9]+$ ]] || [ "$COUNT" -lt 1 ] || [ "$COUNT" -gt 100000 ]; then
            echo -e "${RED}❌ Error: Count must be a number between 1 and 100,000${NC}"
            exit 1
        fi
        
        # Validate batch size
        if ! [[ "$BATCH_SIZE" =~ ^[0-9]+$ ]] || [ "$BATCH_SIZE" -lt 1 ] || [ "$BATCH_SIZE" -gt 500 ]; then
            echo -e "${RED}❌ Error: Batch size must be a number between 1 and 500${NC}"
            exit 1
        fi
        
        run_generation "$COUNT" "$BATCH_SIZE"
        ;;
        
    preview)
        run_preview
        ;;
        
    cleanup)
        run_cleanup
        ;;
        
    help|--help|-h)
        print_help
        ;;
        
    *)
        echo -e "${RED}❌ Error: Unknown command '$COMMAND'${NC}"
        echo ""
        print_help
        exit 1
        ;;
esac




