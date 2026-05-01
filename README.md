# CheckingPlan · Gestión de capacidad

Aplicación web (React + Vite) para gestionar la capacidad del equipo de desarrollo de CheckingPlan, con dos pantallas:

- **Parámetros**: matriz de habilidades y tabla de capacidad mensual, editables y persistentes.
- **Calculadora de plazos**: estima fecha de inicio, programadores asignables y plazo de entrega para una nueva tarea, leyendo las tareas en curso de cada programador desde Zoho Projects.

---

## Estructura

```
checkingplan-capacity/
├── package.json          # frontend (Vite + React)
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── src/
│   ├── main.jsx
│   ├── index.css
│   └── App.jsx           # toda la app en un componente
└── server/               # backend Express (proxy a Zoho)
    ├── package.json
    ├── index.js
    └── .env.example
```

---

## Arrancar el proyecto

Necesitas **Node 18+**.

```bash
# 1. Instalar dependencias del frontend
npm install

# 2. Instalar dependencias del backend
cd server
npm install
cp .env.example .env       # por defecto MODE=mock, no hace falta tocar nada
cd ..

# 3. En una terminal, lanza el backend
npm run server
# → ✓ Backend listening on http://localhost:3001

# 4. En otra terminal, lanza el frontend
npm run dev
# → http://localhost:5173
```

Vite tiene configurado un proxy: cualquier llamada del frontend a `/api/*` se reenvía automáticamente al backend en `localhost:3001`.

---

## Modos del backend (variable `MODE`)

### `MODE=mock` (por defecto)
El backend devuelve tareas de ejemplo hardcodeadas. **No requiere ninguna configuración**, lo que te permite ver toda la app funcionando end-to-end nada más clonar el repo. Útil para:
- Probar la pantalla de parámetros y la calculadora.
- Trabajar en la UI sin depender de Zoho.
- Hacer demo sin credenciales.

### `MODE=zoho`
El backend llama a la **API REST oficial de Zoho Projects** usando OAuth. Para activarlo, en `server/.env`:

```env
MODE=zoho
ZOHO_DC=eu
ZOHO_PORTAL_ID=20059477103
ZOHO_CLIENT_ID=...
ZOHO_CLIENT_SECRET=...
ZOHO_REFRESH_TOKEN=...
```

Y reinicia el servidor.

---

## ¿Por qué no funciona el MCP de Zoho fuera de Claude.ai?

La versión que viste como _artifact_ en la conversación llamaba directamente a `https://api.anthropic.com/v1/messages` con un `mcp_servers: [{ url: "https://claude-zohoprojects.zohomcp.eu/mcp/message", ... }]`. **Eso solo funciona dentro de la sandbox de Claude.ai por tres razones**:

1. **CORS**. La API de Anthropic no acepta peticiones directas desde un navegador cualquiera; el sandbox de las artifacts inyecta cabeceras y enrutado especiales que un navegador "limpio" no tiene.
2. **Autenticación**. Dentro de Claude.ai, la sesión del usuario se propaga automáticamente a la API. Fuera, necesitas una API key de Anthropic — y meter una API key en código de cliente es un riesgo de seguridad inaceptable.
3. **OAuth del MCP**. La URL `claude-zohoprojects.zohomcp.eu` es un servidor MCP **alojado por Anthropic** que está autenticado contra tu cuenta de Zoho a través del flujo OAuth de los _connectors_ de Claude.ai. Esa autenticación no se puede reutilizar desde una aplicación externa: el token vive solo dentro de la sesión de Claude.ai.

**Consecuencia práctica**: para una app standalone hay dos caminos realistas. El más sencillo y robusto es **hablar directamente con la API REST de Zoho Projects** (es lo que hace `MODE=zoho` de este backend). La alternativa sería montar tu propio servidor MCP, pero implica más infraestructura sin aportar nada que la API REST no te dé ya.

---

## Obtener un refresh_token de Zoho (para `MODE=zoho`)

Pasos para Zoho EU (sustituye `.eu` por tu DC si usas otro):

### 1. Registrar la aplicación
- Entra en https://api-console.zoho.eu/
- Crea un cliente tipo **"Self Client"**.
- Anota el `Client ID` y el `Client Secret`.

### 2. Generar un código (grant token)
- En la pestaña **Self Client**, ve a "Generate Code".
- Scope: `ZohoProjects.tasks.READ,ZohoProjects.portals.READ`
- Tiempo de validez: 10 minutos.
- Descripción: lo que quieras.
- **Copia el código generado** — caduca enseguida.

### 3. Intercambiar el código por un refresh_token
Desde tu terminal, en menos de 10 minutos:

```bash
curl -X POST https://accounts.zoho.eu/oauth/v2/token \
  -d "grant_type=authorization_code" \
  -d "client_id=TU_CLIENT_ID" \
  -d "client_secret=TU_CLIENT_SECRET" \
  -d "code=EL_CODIGO_DEL_PASO_2"
```

La respuesta incluye `refresh_token` (válido durante meses) y `access_token` (válido 1 hora). Solo necesitas guardar el `refresh_token`.

### 4. Configurar `.env`

```env
MODE=zoho
ZOHO_DC=eu
ZOHO_PORTAL_ID=20059477103
ZOHO_CLIENT_ID=1000.XXXXXXXX
ZOHO_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ZOHO_REFRESH_TOKEN=1000.xxxxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 5. Reiniciar el backend
```bash
npm run server
```
Verás `mode = zoho` en la salida. La app empezará a usar tareas reales.

El backend cachea el `access_token` en memoria y lo refresca automáticamente cuando caduca, así que solo gestionas el `refresh_token`.

---

## Compilar para producción

```bash
npm run build      # genera /dist (incluye web.config para IIS)
npm run preview    # sirve /dist en local para probar
```

---

## Despliegue en IIS (Windows Server 2016)

La app se despliega como subcarpeta `/checkingplan-capacity/` de un sitio IIS existente. El frontend se sirve como archivos estáticos y las llamadas a `/api/*` se redirigen al backend Node mediante URL Rewrite.

### Requisitos previos

- **Node.js 18+** instalado en el servidor
- **IIS URL Rewrite 2.1** instalado ([iis.net](https://www.iis.net/downloads/microsoft/url-rewrite))
- **IIS Application Request Routing (ARR) 3.0** instalado ([iis.net](https://www.iis.net/downloads/microsoft/application-request-routing))
- ARR habilitado: IIS Manager → nodo raíz → **Application Request Routing Cache** → **Server Proxy Settings** → marcar **Enable proxy** → Apply

### 1. Preparar archivos en el servidor

Copia el proyecto al servidor (sin `node_modules` ni `dist`). Luego en PowerShell:

```powershell
# Instalar dependencias del frontend y compilar
npm install
npm run build          # genera dist/ con web.config incluido

# Instalar dependencias del backend
cd server
npm install

# Configurar variables de entorno
copy .env.example .env
notepad .env           # rellenar con credenciales Zoho
```

### 2. Configurar IIS

En IIS Manager:

1. Clic derecho sobre la carpeta `checkingplan-capacity` → **Convert to Application**
2. **Application Pool**: asignar un pool con **.NET CLR version = No Managed Code** (evita que el pipeline ASP.NET del sitio padre interfiera)
3. **Physical path**: apuntar a la carpeta `dist/` generada por el build

El archivo `dist/web.config` (incluido automáticamente en el build) gestiona:
- Proxy de `/api/*` → Node.js en puerto 3001
- Fallback SPA para rutas del frontend

### 3. Instalar Node como servicio de Windows (con pm2)

Para que el backend arranque automáticamente con el servidor, ejecutar en **PowerShell como Administrador**:

```powershell
# Reubicar npm global a una carpeta accesible por SYSTEM
New-Item -ItemType Directory -Force "C:\npm"
npm config set prefix "C:\npm"
[Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";C:\npm", "Machine")
$env:PATH = $env:PATH + ";C:\npm"

# Instalar pm2 y pm2-windows-service en la nueva ubicación
npm install -g pm2 pm2-windows-service

# Carpeta de datos pm2 accesible por SYSTEM
New-Item -ItemType Directory -Force "C:\pm2"
[Environment]::SetEnvironmentVariable("PM2_HOME", "C:\pm2", "Machine")
$env:PM2_HOME = "C:\pm2"

# Arrancar el backend y guardar la lista de procesos
cd C:\...\checkingplan-capacity\server
pm2 start .\index.js --name checkingplan-capacity
pm2 save

# Registrar como servicio de Windows
pm2-service-install -n PM2
```

Durante la instalación del servicio responder:
- `PM2_HOME value` → `C:\pm2`
- `Set PM2_SERVICE_SCRIPTS` → dejar vacío
- `PM2_SERVICE_PM2_DIR` → `C:\npm\node_modules\pm2\index.js`

El servicio **PM2** aparecerá en `services.msc` con inicio automático.

### Gestión del servicio

```powershell
# Ver estado del proceso Node
pm2 list
pm2 logs checkingplan-capacity   # logs en tiempo real

# Reiniciar el backend (tras cambios en .env, por ejemplo)
pm2 restart checkingplan-capacity

# Estado del servicio Windows
Get-Service PM2
```

### Verificar que todo funciona

```
GET http://TU_SERVIDOR/checkingplan-capacity/api/health
```

Respuesta esperada:
```json
{ "ok": true, "mode": "zoho", "portal_id": "20059477103", "dc": "eu" }
```

---

## Datos persistentes

La pantalla de parámetros guarda todo (programadores, zpuids, habilidades, capacidades) en `localStorage` del navegador bajo la clave `checkingplan_capacity_v1`. Si quieres reset total, abre devtools y borra la entrada, o usa el botón **reset** del header.

El portal de Zoho está fijado a `20059477103` (conpas). Si necesitas cambiarlo: en `src/App.jsx` la constante `ZOHO_PORTAL_ID` y en `server/.env` la variable `ZOHO_PORTAL_ID`.

---

## Equipo cargado por defecto

| Programador | Email | zpuid (conpas) |
|---|---|---|
| Ricardo Cruz | ricardo.cruz@cuatroochenta.com | 5125000004360033 |
| Eduardo Peña | eduardo.pena@cuatroochenta.com | 5125000004207087 |
| Joseph Rafael Montenegro | rafael.montenegro@cuatroochenta.com | 5125000023057263 |

Editables y persistentes desde la pantalla **Parámetros**.
