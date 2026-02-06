#!/bin/bash

# Navigate to the script directory
# This ensures relative paths (like finding .env in parent) work correctly.
cd "$(dirname "$0")"

# Optional: Add PATH to python if cron doesn't find it (common issue)
# export PATH=$PATH:/usr/local/bin

echo "Starting Daily Rate Update: $(date)"

# Run the python orchestrator
python3 run_automation.py

echo "Job Finished: $(date)"
