# Integración del frontend con el motor C++

## Decisión de transporte

La integración usa HTTP local para enviar snapshots discretos y recibir el
resultado completo de cada paso. Es más sencillo de depurar que mantener un
WebSocket para este motor: no existe un estado de carrera persistente en el
backend y no se debe iniciar un trabajo MPI por fotograma. La física principal
continúa siendo JavaScript por defecto.

El cliente independiente está en `frontend/src/game/BackendClient.js`; el
laboratorio permite probar snapshots con los motores C++, y la carrera ofrece
modos experimentales con fallback automático. JavaScript calcula controles,
aceleración, velocidad y dirección. En secuencial/OpenMP, el resultado
cinemático lineal C++ actualiza la posición del jugador, mientras los rivales,
colisiones, vueltas y el resto de la física permanecen en JavaScript. MPI
envía snapshots en sombra y no modifica posiciones de la carrera por su
latencia. Secuencial/OpenMP se consultan a aproximadamente 10 Hz y MPI a 2 Hz,
con una solicitud en vuelo.

Los identificadores de solicitud y la secuencia local descartan respuestas
obsoletas. Una respuesta de movimiento secuencial/OpenMP que tarde más de
300 ms causa fallback a JavaScript; también se vuelve a JavaScript ante error o
desconexión. En ambos casos la carrera continúa. El cambio no supone que C++
controle aceleración, dirección, conducción de rivales ni progresión.

## Servicio y seguridad

El servidor HTTP Node.js valida las solicitudes y delega los cálculos en el
adaptador C++ existente. Debe escuchar únicamente en `127.0.0.1`; el navegador
no recibe acceso al daemon Docker. Para MPI, el servidor del host invoca el
script autorizado del clúster ya configurado; los contenedores no montan el
socket de Docker.

Se permite el origen del frontend Vite local. El servidor limita el tamaño de
la solicitud, los modos, hilos/procesos, vehículos, pasos y `deltaTime`;
rechaza IDs duplicados, valores no finitos y ejecuciones concurrentes.
Cancelación, desconexión y error hacen que el frontend vuelva al movimiento
local sin reiniciar la carrera.

## Protocolo HTTP

### Estado

`GET /api/health` informa disponibilidad del servicio. No prueba por sí solo
que Docker esté activo ni garantiza que cada modo se pueda ejecutar.

### Simulación

`POST /api/simulate` acepta JSON con un identificador de solicitud, motor,
pasos, intervalo y el estado inicial de cada vehículo:

```json
{
  "requestId": "demo-1",
  "mode": "openmp",
  "threads": 4,
  "steps": 10,
  "deltaTime": 0.016666667,
  "vehicles": [
    {
      "id": 0,
      "x": 0,
      "z": 0,
      "speed": 2,
      "direction": 0,
      "collisionRadius": 1,
      "active": true
    }
  ]
}
```

Los valores admitidos para `mode` son `sequential`, `openmp` y `mpi`.
OpenMP recibe `threads`; MPI recibe `processes`. La interfaz incluye además el
modo `local`, que no envía simulación al servidor.

La respuesta devuelve el mismo `requestId`, los vehículos con las posiciones
actualizadas por el motor C++, pares de colisión, modo/recursos efectivos y
mediciones del cálculo, incluyendo CPU del proceso y RSS pico. MPI informa los
nodos usados cuando esa información está disponible; CPU y RSS MPI representan
el máximo entre ranks, no la suma. Los errores HTTP incluyen un mensaje
legible; los códigos indican JSON inválido, validación fallida, servicio
ocupado o backend no disponible.

El motor calcula movimiento rectilíneo usando velocidad, dirección y
`deltaTime`, y detecta solapamientos circulares. No calcula aceleración,
física de pista, IA, respuesta física de colisión ni vueltas. La respuesta
visual de impacto y la IA de los rivales continúan en el juego.

## Ejecución local

Desde la raíz del repositorio:

```bash
cmake -S backend -B backend/build -DCMAKE_BUILD_TYPE=Release
cmake --build backend/build --parallel
node backend/service/server.mjs
```

En otra terminal, inicia el juego:

```bash
cd frontend
npm run dev
```

Abre el laboratorio paralelo para enviar una prueba aislada o elige un modo
C++ secuencial/OpenMP experimental antes de iniciar una carrera. Para MPI
inicia primero los tres contenedores y comprueba su distribución:

```bash
cd ..
./infrastructure/mpi-cluster/scripts/cluster.sh up
./infrastructure/mpi-cluster/scripts/cluster.sh verify
```

La disponibilidad real de cada ruta depende de que el motor se haya compilado
con la tecnología correspondiente y, para MPI distribuido, de que el clúster
esté activo.

## Benchmark HTTP reproducible

Con el servidor Node y los contenedores MPI iniciados, desde la raíz:

```bash
node backend/service/benchmark.mjs --vehicles=64 --steps=120 --repetitions=5
```

El script compara snapshots e IDs idénticos en secuencial, OpenMP con 1/2/4
hilos y MPI con 1/2/3 procesos. Verifica que estados y pares finales coincidan
con la primera respuesta secuencial. Reporta mediana, media y p95 con tamaño
de muestra de latencia HTTP, tiempos C++ por etapa, speedup/eficiencia y
CPU/RSS del proceso C++ (MPI: máximo por rank). La latencia HTTP y el tiempo
del kernel son mediciones separadas; HTTP incluye el lanzamiento de
procesos/Compose. El p95 de muestras pequeñas tiene baja resolución y no es
una garantía de latencia.

## Limitaciones

- Los procesos C++ se invocan para cada actualización; secuencial/OpenMP
  calculan el desplazamiento del jugador a partir del snapshot, no la física
  completa de la carrera.
- MPI se actualiza a una frecuencia inferior y permanece en sombra: el costo
  de lanzamiento y comunicación no es adecuado para movimiento interactivo.
- El modo MPI en los contenedores comparte el hardware del host; no representa
  tres equipos físicos.
- La aceleración, giro, IA, clasificación, progreso de pista, nitro y
  resolución física de colisiones siguen siendo locales.
- Ninguno de los modos de backend sustituye la carrera completa JavaScript;
  MPI tampoco aplica su resultado cinemático al jugador.
