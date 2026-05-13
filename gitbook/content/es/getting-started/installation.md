# Instalación

Guía detallada de instalación de ebRouter con consejos de solución de problemas.

---

## Requisitos

### Requisitos del sistema

- **Node.js**: Versión 20.0.0 o superior
- **npm**: Versión 10.0.0 o superior (viene con Node.js)
- **OS**: macOS, Linux, Windows (WSL recomendado)
- **Espacio en disco**: ~200MB para la instalación

### Verifica tu versión

```bash
node --version
# Debería mostrar v20.x.x o superior

npm --version
# Debería mostrar 10.x.x o superior
```

**¿No tienes Node.js?** Instálalo desde [nodejs.org](https://nodejs.org/)

---

## Métodos de instalación

### Método 1: Instalación global (Recomendado)

Instala ebRouter globalmente para usar desde cualquier lugar:

```bash
npm install -g ebrouter
```

**Iniciar ebRouter:**

```bash
ebrouter
```

**Beneficios:**
- ✅ Ejecuta desde cualquier directorio
- ✅ Comando simple: `ebrouter`
- ✅ Auto-actualizaciones con `npm update -g ebrouter`

### Método 2: Instalación local

Instala en un proyecto específico:

```bash
mkdir my-ebrouter
cd my-ebrouter
npm install ebrouter
```

**Iniciar ebRouter:**

```bash
npx ebrouter
```

**Beneficios:**
- ✅ Aislado por proyecto
- ✅ Control de versiones por proyecto
- ✅ Sin contaminación del namespace global

### Método 3: Desde el código fuente (Desarrollo)

Clona y compila desde GitHub:

```bash
git clone https://github.com/YOUR_ORG/ebRouter.git
cd ebrouter/app
npm install
npm run build
npm start
```

**Beneficios:**
- ✅ Últimas características de desarrollo
- ✅ Contribuir al desarrollo
- ✅ Modificaciones personalizadas

---

## Primera ejecución

### Iniciar el servidor

```bash
ebrouter
```

**Qué sucede:**
1. El servidor inicia en `http://localhost:20128`
2. El dashboard se abre automáticamente en el navegador
3. Se crea el directorio de datos en `~/.9router`
4. API key generada automáticamente

### Login del dashboard

**Credenciales por defecto:**
- Contraseña: `123456`

**⚠️ Cambia la contraseña inmediatamente:**
1. Inicia sesión en el dashboard
2. Settings → Change Password
3. Usa una contraseña fuerte

### Obtén tu API key

```
Dashboard → Settings → API Keys
→ Copia tu API key
→ Úsala en herramientas CLI
```

**Ejemplo de formato de API key:**
```
9r_1234567890abcdef1234567890abcdef
```

---

## Verificar la instalación

### Verifica el estado del servidor

```bash
curl http://localhost:20128/health
```

**Respuesta esperada:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### Lista los modelos disponibles

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer your-api-key"
```

**Respuesta esperada:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "cc/claude-opus-4-5-20251101",
      "object": "model",
      "created": 1234567890,
      "owned_by": "claude-code"
    }
  ]
}
```

### Prueba el chat completion

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "cc/claude-opus-4-5-20251101",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

---

## Configuración

### Variables de entorno

Crea un archivo `.env` o establece variables de entorno:

```bash
# Security (REQUIRED in production)
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"

# Storage
export DATA_DIR="~/.9router"

# Server
export PORT="20128"
export NODE_ENV="production"

# Logging
export ENABLE_REQUEST_LOGS="false"
```

### Directorio de datos

**Ubicación por defecto:** `~/.9router`

**Contenido:**
```
~/.9router/
  ├── db.json           # Database (providers, combos, usage)
  ├── api-keys.json     # API keys
  └── logs/             # Request logs (if enabled)
```

**Cambiar ubicación:**

```bash
export DATA_DIR="/custom/path"
ebrouter
```

### Configuración de puerto

**Puerto por defecto:** `20128`

**Cambiar puerto:**

```bash
export PORT="3000"
ebrouter
```

**O usa la línea de comandos:**

```bash
ebrouter --port 3000
```

---

## Solución de problemas

### Puerto ya en uso

**Error:**
```
Error: listen EADDRINUSE: address already in use :::20128
```

**Solución 1: Mata el proceso existente**

```bash
# Encuentra proceso usando el puerto 20128
lsof -i :20128

# Mata el proceso
kill -9 <PID>
```

**Solución 2: Usa otro puerto**

```bash
ebrouter --port 3000
```

### Permiso denegado

**Error:**
```
Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/ebrouter'
```

**Solución: Usa sudo (no recomendado) o corrige los permisos de npm**

```bash
# Corregir permisos de npm (recomendado)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Luego instalar nuevamente
npm install -g ebrouter
```

### Versión de Node.js muy antigua

**Error:**
```
Error: The engine "node" is incompatible with this module
```

**Solución: Actualizar Node.js**

```bash
# Usando nvm (recomendado)
nvm install 20
nvm use 20

# O descargar desde nodejs.org
```

### El dashboard no se abre

**Problema:** El dashboard no se abre automáticamente

**Solución 1: Abrir manualmente**

```
http://localhost:20128
```

**Solución 2: Verifica el firewall**

```bash
# macOS: Permitir Node.js en System Preferences → Security
# Linux: Verificar iptables
# Windows: Verificar Windows Firewall
```

### No se puede conectar a proveedores

**Problema:** El login OAuth falla o la API key es inválida

**Solución 1: Verifica la conexión a internet**

```bash
ping google.com
```

**Solución 2: Verifica el estado del proveedor**

- Claude Code: [status.anthropic.com](https://status.anthropic.com)
- OpenAI: [status.openai.com](https://status.openai.com)
- Gemini: [status.cloud.google.com](https://status.cloud.google.com)

**Solución 3: Regenera la API key**

```
Dashboard → Provider → Disconnect → Reconnect
```

### Uso alto de memoria

**Problema:** ebRouter usa demasiada RAM

**Solución: Reinicia el servidor**

```bash
# Detener
pkill -f ebrouter

# Iniciar
ebrouter
```

**O usa PM2 para auto-reinicio:**

```bash
npm install -g pm2
pm2 start ebrouter --name ebrouter
pm2 save
```

---

## Opciones de despliegue

### Desarrollo local

```bash
npm install -g ebrouter
ebrouter
```

**Caso de uso:** Codificación personal, pruebas

### Servidor VPS/Cloud

```bash
# Instalar
npm install -g ebrouter

# Configurar
export JWT_SECRET="your-secure-secret"
export INITIAL_PASSWORD="your-password"
export NODE_ENV="production"

# Iniciar con PM2
npm install -g pm2
pm2 start ebrouter --name ebrouter
pm2 save
pm2 startup
```

**Caso de uso:** Acceso de equipo, codificación remota

### Docker

```bash
docker pull ebrouter/ebrouter:latest

docker run -d \
  -p 20128:20128 \
  -e JWT_SECRET="your-secure-secret" \
  -e INITIAL_PASSWORD="your-password" \
  -v 9router-data:/root/.9router \
  --name ebrouter \
  ebrouter/ebrouter:latest
```

**Caso de uso:** Despliegue containerizado, Kubernetes

### Proxy reverso (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:20128;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        
        # SSE support for streaming
        proxy_buffering off;
        proxy_read_timeout 86400;
    }
}
```

**Caso de uso:** HTTPS, dominio personalizado, balanceo de carga

---

## Desinstalación

### Eliminar instalación global

```bash
npm uninstall -g ebrouter
```

### Eliminar el directorio de datos

```bash
rm -rf ~/.9router
```

### Eliminar la configuración

```bash
# Eliminar variables de entorno del archivo de configuración del shell
nano ~/.bashrc  # o ~/.zshrc
# Eliminar exports relacionados con ebrouter
```

---

## Próximos pasos

- [Guía para empezar](../getting-started.md) - Conecta proveedores y comienza a codificar
- [Características](../features/) - Explora seguimiento de cuota, combos, despliegue
- [Solución de problemas](../troubleshooting.md) - Resuelve problemas comunes

---

## ¿Necesitas ayuda?

- **Sitio web**: [ebrouter.example.com](https://ebrouter.example.com)
- **GitHub**: [github.com/YOUR_ORG/ebRouter](https://github.com/YOUR_ORG/ebRouter)
- **Issues**: [github.com/YOUR_ORG/ebRouter/issues](https://github.com/YOUR_ORG/ebRouter/issues)
