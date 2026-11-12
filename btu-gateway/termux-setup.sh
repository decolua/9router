#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
pkg update -y
pkg install -y python git
mkdir -p "$HOME/btu-gateway"
curl -fsSL "https://raw.githubusercontent.com/bernardjstander123-droid/9router/master/btu-gateway/server.py" -o "$HOME/btu-gateway/server.py"
chmod 700 "$HOME/btu-gateway"
echo "BTU gateway downloaded to $HOME/btu-gateway/server.py"
echo "Configure BTU_DEVICE_TOKEN and BTU_3MIN_API_KEY in your Termux session, then run:"
echo "python $HOME/btu-gateway/server.py"
