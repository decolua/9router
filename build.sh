npm run build
set -e
cp -a .next/standalone/. product/
mkdir -p product/.next
cp -a .next/static product/.next/
cp -a public product/
