# 🏠 Despliegue en localhost

Ejecuta 10router en tu máquina local para desarrollo y uso personal.

---

## 📦 Instalación

Instala 10router globalmente vía npm:

```bash
npm install -g 10router
```

**Requisitos:**
- Node.js 20 o superior
- npm 9 o superior

---

## 🚀 Iniciar el servidor

Inicia 10router con un solo comando:

```bash
10router
```

El dashboard se abrirá automáticamente en tu navegador en `http://localhost:3000`

**Configuración por defecto:**
- **Dashboard**: `http://localhost:3000`
- **API Endpoint**: `http://localhost:20128/v1`
- **Directorio de datos**: `~/.9router` (el nombre del directorio no ha cambiado respecto a la versión anterior por compatibilidad)

---

## 🔧 Configuración

### Directorio de datos personalizado

Establece un directorio de datos personalizado usando una variable de entorno:

```bash
DATA_DIR=/path/to/data 10router
```

### Puerto personalizado

El puerto de API (20128) y el puerto del dashboard (3000) están configurados en la aplicación. Para cambiarlos, necesitarás modificar el código fuente o usar variables de entorno si se soportan.

---

## 🛑 Detener el servidor

Presiona `Ctrl+C` en la terminal donde 10router se está ejecutando.

```bash
# En la terminal ejecutando 10router
^C  # Presiona Ctrl+C
```

El servidor se apagará correctamente y guardará todos los datos.

---

## 🔄 Reiniciar el servidor

Simplemente ejecuta el comando de inicio nuevamente:

```bash
10router
```

Todas tus configuraciones, API keys y combos se preservan en el directorio de datos.

---

## 📊 Actualizar 10router

Actualiza a la última versión:

```bash
npm update -g 10router
```

Verifica tu versión actual:

```bash
npm list -g 10router
```

---

## 🔍 Solución de problemas

### Puerto ya en uso

Si el puerto 20128 o 3000 ya está en uso:

```bash
# Encontrar proceso usando el puerto (macOS/Linux)
lsof -i :20128
lsof -i :3000

# Matar el proceso
kill -9 <PID>
```

### Errores de permisos

Si encuentras errores de permisos durante la instalación:

```bash
# Usar sudo (no recomendado)
sudo npm install -g 10router

# O corregir los permisos de npm (recomendado)
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### Problemas con el directorio de datos

Si el directorio de datos no es accesible:

```bash
# Verificar permisos
ls -la ~/.9router

# Corregir permisos
chmod 755 ~/.9router
```

---

## 📁 Estructura del directorio de datos

```
~/.9router/
├── db.json           # Main database (providers, combos, settings)
├── logs/             # Application logs
└── cache/            # Temporary cache files
```

**Respaldar tus datos:**

```bash
# Respaldo
cp -r ~/.9router ~/.9router.backup

# Restaurar
cp -r ~/.9router.backup ~/.9router
```

---

## 🔗 Próximos pasos

- [Conectar proveedores](/providers/subscription.md)
- [Crear combos](/features/combos.md)
- [Integrar con herramientas CLI](/integration/cursor.md)
