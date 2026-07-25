#!/bin/bash

# Скрипт запуска 9router через docker-compose

echo "=== 9Router Startup ==="

# Создаем директории для данных, если их нет
mkdir -p data data-home

# Останавливаем и удаляем старый контейнер если есть
docker-compose down 2>/dev/null

# Собираем и запускаем
docker-compose up -d --build

echo "=== 9Router started on http://localhost:20128 ==="
echo "=== Dashboard: http://localhost:20128/dashboard/endpoint ==="
echo ""
echo "Для просмотра логов: docker-compose logs -f"
echo "Для остановки: docker-compose down"