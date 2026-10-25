#!/usr/bin/env bash
# Mac / Linux: masayi baslatir. Internete acmak icin: ./baslat.sh --internet
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[HATA] Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kur."
  exit 1
fi
if [ ! -d node_modules/ws ]; then
  echo "Ilk calistirma: gerekli paket kuruluyor..."
  npm install --no-audit --no-fund --loglevel=error || exit 1
fi
exec node server/index.js "$@"
