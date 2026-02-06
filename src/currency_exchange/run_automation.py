
import subprocess
import sys
import os

def run_script(script_name):
    print(f"--- Running {script_name} ---")
    result = subprocess.run([sys.executable, script_name], capture_output=True, text=True)
    print(result.stdout)
    if result.stderr:
        print("Errors:")
        print(result.stderr)
    if result.returncode != 0:
        print(f"Script {script_name} failed with code {result.returncode}")
        return False
    return True

def main():
    print("Starting Exchange Rate Automation...")

    # Determine script directory to ensure we find siblings
    script_dir = os.path.dirname(os.path.abspath(__file__))
    fetch_script = os.path.join(script_dir, "fetch_icegate_rates.py")
    update_script = os.path.join(script_dir, "update_zoho_rates.py")

    # Step 1: Fetch
    # Pass any args (like --date) to the fetch script
    args = sys.argv[1:]
    fetch_cmd = [fetch_script] + args
    
    print(f"--- Running {fetch_script} {' '.join(args)} ---")
    result = subprocess.run([sys.executable] + fetch_cmd, capture_output=True, text=True)
    print(result.stdout)
    if result.returncode != 0:
        print("Aborting: Fetch failed.")
        print(result.stderr)
        return
        
    # Step 2: Update
    print(f"--- Running {update_script} ---")
    result = subprocess.run([sys.executable, update_script], capture_output=True, text=True)
    print(result.stdout)

        
    print("Automation completed successfully.")

if __name__ == "__main__":
    main()
