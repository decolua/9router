#!/usr/bin/env python3
"""
🚀 9router Russian — Universal Auto Setup
Одно-кликовое развёртывание (Windows/Linux/Mac)
"""

import os
import sys
import json
import time
import shutil
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

# ─── Colors ────────────────────────────────
GREEN  = '\033[92m' if os.name != 'nt' else ''
YELLOW = '\033[93m' if os.name != 'nt' else ''
RED    = '\033[91m' if os.name != 'nt' else ''
CYAN   = '\033[96m' if os.name != 'nt' else ''
BOLD   = '\033[1m'  if os.name != 'nt' else ''
NC     = '\033[0m'  if os.name != 'nt' else ''

def print_step(num, text):
    print(f"\n[{num}/6] {text}")

def print_ok(text):
    print(f"{GREEN}[✅] {text}{NC}")

def print_warn(text):
    print(f"{YELLOW}[⚠️] {text}{NC}")

def print_err(text):
    print(f"{RED}[❌] {text}{NC}")

def print_info(text):
    print(f"{CYAN}[ℹ️] {text}{NC}")

# ─── MAIN ──────────────────────────────────
def main():
    work_dir = Path.cwd()
    print(f"""
{CYAN}╔══════════════════════════════════════════╗
║    🚀 9router Russian Auto Setup         ║
║    Одно-кликовое развёртывание           ║
╚══════════════════════════════════════════╝{NC}
""")

    # ═══════════════════════════════════════
    # ШАГ 1: Поиск хранилища с ключами
    # ═══════════════════════════════════════
    print_step(1, "🔑 Поиск хранилища с ключами")
    print(f"""{CYAN}  Укажи путь к папке '9router-secrets', где лежат:{NC}
    • .env — с API-ключами (OpenAI, Claude и др.)
    • providers/*.json — файлы провайдеров

  Где хранить: Яндекс.Диск, Google Drive, Dropbox,
  USB-флешка, сетевая папка, Nextcloud — что угодно.
  Просто скопируй папку на новый комп и укажи путь.
""")

    secrets_dir = None

    # 1) Переменная окружения SECRETS_STORAGE
    env_storage = os.environ.get("SECRETS_STORAGE", "")
    if env_storage and Path(env_storage).exists():
        secrets_dir = Path(env_storage)
        print_ok(f"Используется SECRETS_STORAGE: {secrets_dir}")

    # 2) Ищем в облачных хранилищах
    if secrets_dir is None:
        cloud_bases = [
            Path.home() / "Yandex.Disk",
            Path.home() / "Downloads" / "Yandex.Disk",
            Path.home() / "Google Drive",
            Path.home() / "My Drive",
            Path.home() / "Dropbox",
            Path.home() / "Nextcloud",
            Path.home(),
        ]
        for base in cloud_bases:
            candidate = base / "9router-secrets"
            if candidate.exists() and (candidate / ".env").exists():
                secrets_dir = candidate
                print_ok(f"Найдена папка с ключами: {secrets_dir}")
                break

    # 3) Спрашиваем у пользователя
    if secrets_dir is None:
        print_warn("Папка '9router-secrets' не найдена автоматически.")
        print(f"{CYAN}  Укажи путь к ней вручную.{NC}")
        print("  Это может быть: Яндекс.Диск / Google Drive / USB-флешка / сетевая папка")
        user_input = input(f"{YELLOW}  Путь к папке 9router-secrets (Enter чтобы пропустить): {NC}").strip()
        if user_input:
            p = Path(user_input)
            if p.exists():
                secrets_dir = p
                print_ok(f"Используется: {secrets_dir}")
            else:
                print_err(f"Папка не найдена: {p}")
        else:
            print_warn("Пропускаем импорт ключей.")

    if secrets_dir:
        print_info(f"Содержимое: {[f.name for f in secrets_dir.iterdir() if f.is_file()][:5]}")

    # ═══════════════════════════════════════
    # ШАГ 2: Копирование .env
    # ═══════════════════════════════════════
    print_step(2, "📝 Настройка .env")

    env_path = work_dir / ".env"
    
    if secrets_dir and (secrets_dir / ".env").exists():
        shutil.copy2(secrets_dir / ".env", env_path)
        print_ok(".env скопирован из хранилища ключей")
    elif env_path.exists():
        print_ok(".env уже существует")
    elif (work_dir / ".env.example").exists():
        shutil.copy2(work_dir / ".env.example", env_path)
        print_warn(".env создан из .env.example. Добавь свои API-ключи!")
    else:
        print_err(".env не найден!")
        sys.exit(1)

    # ═══════════════════════════════════════
    # ШАГ 3: Проверка Docker
    # ═══════════════════════════════════════
    print_step(3, "🐳 Проверка Docker")

    try:
        subprocess.run(["docker", "info"], capture_output=True, check=True)
        print_ok("Docker работает")
    except (subprocess.CalledProcessError, FileNotFoundError):
        print_err("Docker не запущен или не установлен!")
        print("      Установи Docker: https://www.docker.com/products/docker-desktop/")
        print("      На Linux: sudo apt install docker.io && sudo systemctl start docker")
        sys.exit(1)

    # ═══════════════════════════════════════
    # ШАГ 4: Сборка и запуск
    # ═══════════════════════════════════════
    print_step(4, "🏗️ Сборка и запуск 9router")

    # Остановить старый
    subprocess.run(["docker-compose", "down"], capture_output=True)

    # Создать папки
    (work_dir / "data").mkdir(exist_ok=True)
    (work_dir / "data-home").mkdir(exist_ok=True)

    # Запустить
    result = subprocess.run(
        ["docker-compose", "up", "-d", "--build"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print_err(f"Ошибка запуска: {result.stderr[:200]}")
        sys.exit(1)
    print_ok("9router запущен")

    # Ждать готовности
    print("\n[⏳] Ожидание готовности 9router (30 сек)...")
    ready = False
    for i in range(10):
        time.sleep(3)
        try:
            req = urllib.request.Request("http://localhost:20128/")
            resp = urllib.request.urlopen(req, timeout=2)
            if resp.status in (200, 301, 302, 401):
                print_ok("9router готов на http://localhost:20128")
                ready = True
                break
        except Exception:
            pass

    if not ready:
        print_warn("9router не отвечает. Проверь: docker-compose logs")

    # ═══════════════════════════════════════
    # ШАГ 5: Импорт провайдеров
    # ═══════════════════════════════════════
    print_step(5, "🔌 Импорт провайдеров")

    providers_dir = secrets_dir / "providers" if secrets_dir else None
    
    if providers_dir and providers_dir.exists():
        print_info(f"Импорт JSON-провайдеров из {providers_dir}")
        for f in sorted(providers_dir.glob("*.json")):
            print(f"    Загрузка: {f.name}")
            try:
                with open(f, "rb") as fp:
                    data = fp.read()
                req = urllib.request.Request(
                    "http://localhost:20128/api/providers/connection",
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                urllib.request.urlopen(req, timeout=10)
                print_ok(f"{f.stem} импортирован")
            except Exception as e:
                print_warn(f"Ошибка импорта {f.stem}: {str(e)[:60]}")
    else:
        # Пробуем локальный JSON
        local_json = work_dir / "add-ollama.json"
        if local_json.exists():
            print("    Импорт локального провайдера: add-ollama.json")
            try:
                with open(local_json, "rb") as fp:
                    data = fp.read()
                req = urllib.request.Request(
                    "http://localhost:20128/api/providers/connection",
                    data=data,
                    headers={"Content-Type": "application/json"},
                    method="POST"
                )
                urllib.request.urlopen(req, timeout=10)
            except Exception:
                pass
        print_info("Провайдеры не импортированы (нет папки providers/)")

    # ═══════════════════════════════════════
    # ИТОГ
    # ═══════════════════════════════════════
    print(f"""
{GREEN}╔══════════════════════════════════════════╗
║    🎉 9router RUSSIAN ЗАПУЩЕН!          ║
╠══════════════════════════════════════════╣
║  📋 Сайт:    http://localhost:20128      ║
║  🔑 API:     http://localhost:20128/api/v1 ║
║  🐳 Docker:  9router (Up)               ║
╚══════════════════════════════════════════╝{NC}
""")
    print("Полезные команды:")
    print("  docker-compose logs -f        — логи")
    print("  docker-compose down           — остановить")
    print("  docker-compose up -d          — перезапустить")
    print("  node autonomous/swarm-master.py \"задача\" — ИИ-оркестратор")
    if secrets_dir:
        print(f"\n📁 Хранилище ключей: {secrets_dir}")
        print("   (скопируй эту папку на новый комп и укажи путь при установке)")

if __name__ == "__main__":
    main()