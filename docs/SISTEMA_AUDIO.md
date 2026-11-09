# Sistema de audio de NEON RUSH

## Objetivo

Implementar un sistema de audio centralizado para la experiencia del juego sin introducir recursos de terceros no autorizados. Se prioriza Web Audio API para generar efectos procedurales y música ligera adaptada a la pantalla actual.

## Arquitectura

- `frontend/src/game/AudioManager.js` contiene el gestor principal de audio.
- Se guarda la configuración en `localStorage` bajo la clave `neon-rush-audio-settings`.
- Los eventos reales de carrera se convierten en sonidos del juego en vez de reproducirse aleatoriamente.
- La música cambia según el contexto: menú o carrera.
- El motor genera una base sonora continua que responde a la velocidad y al uso de nitro.

## Recursos utilizados

Todos los efectos musicales y sonoros son sintéticos y procedurales. No se agregan archivos de audio externos ni activos con licencias ambiguas.

### Tipo de recursos
- Generación procedimental con `OscillatorNode`, `GainNode`, `BiquadFilterNode` y `StereoPannerNode`.
- Licencia: compatible con uso local del juego y sin dependencias de terceros.
- Autor: procedimental, generado por la aplicación.
- Modificaciones: adaptado a UX de juego, volumen y eventos del coche.

## Controles disponibles

La pantalla de configuración incluye:
- Volumen general
- Volumen de música
- Volumen de efectos
- Silenciar
- Persistencia automática en navegador

La reproducción solo se habilita tras interacción del usuario para respetar la política de autoplay de los navegadores.

## Eventos conectados

- `race_started`: inicio de la carrera y arranque de música.
- `collision`: impacto contra obstáculos o barreras.
- `obstacle_avoided`: aviso de evasión.
- `jump_landed`: aterrizaje tras salto.
- `nitro_second`: secuencia de nitro.
- `speed_sample`: picos de velocidad relevantes.
- `race_finished` y `race_abandoned`: disminución del motor y retorno a la música del menú.

## Limitaciones conocidas

- No existe un backend ni un pipeline de assets de audio externos; por tanto, la solución es procedural y ligera.
- La verificación visual y auditiva completa requiere un navegador real con reproducción de audio y salida del sistema.
- En este entorno no se dispone de benchmarking automático para comprobar rendimiento real del audio ni UX en navegador.
