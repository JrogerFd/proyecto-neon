# Auditoría final de la Fase 7

## Objetivo
Auditar la estabilidad y la consistencia del videojuego antes de preparar la versión final, sin reconstruir funcionalidades ya validadas ni iniciar el Sprint 7.8.2.

## Alcance revisado
- Menú principal
- Carrera rápida
- Vehículos
- Garaje
- Circuitos
- Física
- Colisiones
- IA
- Nitro
- Obstáculos
- Economía
- Tienda
- Desafíos
- Misiones
- Campeonatos
- Perfil
- Estadísticas
- Progresión
- Laboratorio paralelo

## Estado real por área

| Área | Estado |
|---|---|
| Menú principal | COMPLETADO Y PROBADO |
| Carrera rápida | COMPLETADO Y PROBADO |
| Vehículos | COMPLETADO Y PROBADO |
| Garaje | COMPLETADO Y PROBADO |
| Circuitos | COMPLETADO Y PROBADO |
| Física | COMPLETADO Y PROBADO |
| Colisiones | COMPLETADO Y PROBADO |
| IA | COMPLETADO Y PROBADO |
| Nitro | COMPLETADO Y PROBADO |
| Obstáculos | COMPLETADO Y PROBADO |
| Economía | COMPLETADO Y PROBADO |
| Tienda | COMPLETADO Y PROBADO |
| Desafíos | COMPLETADO Y PROBADO |
| Misiones | COMPLETADO Y PROBADO |
| Campeonatos | COMPLETADO Y PROBADO |
| Perfil | COMPLETADO Y PROBADO |
| Estadísticas | COMPLETADO Y PROBADO |
| Progresión | COMPLETADO Y PROBADO |
| Laboratorio paralelo | IMPLEMENTADO PERO NO PROBADO |

## Hallazgos de estabilidad

### 1) Manejo de timers y polling de backend
Se detectó un riesgo de fuga de temporizadores en `frontend/src/main.js`: el polling de salud del backend se ejecutaba cada 3 segundos con `window.setInterval`, pero no se limpiaba cuando la app dejaba de usarse o cuando la sesión cambió de pantalla. Esto podía dejar procesos activos en segundo plano y provocar llamadas redundantes mientras la carrera o la navegación ya no estaban relevantes.

Corrección aplicada:
- El intervalo se conserva en una referencia controlada.
- Se limpia en `beforeunload` y al cerrar la sesión activa.
- Se evita que la carrera siga ejecutándose en segundo plano al navegar fuera del modo carrera.

### 2) Carrera activa persistiendo al cambiar de pantalla
Cuando el usuario cambiaba de vista mientras una carrera estaba activa, la lógica no cerraba explícitamente la instancia de `Race` antes de reusar la pantalla. Esto dejaba una instancia viva y podía provocar render, colisiones o eventos en segundo plano aunque el usuario ya no estuviera en la pantalla de competición.

Corrección aplicada:
- Antes de cambiar a una vista distinta a `race`, se destruye la carrera activa si existe.
- Se restablecen el contenedor de carrera y la escena principal para evitar estados inconsistentes.

### 3) Riesgo de intervalo de red duplicado
El código se mantenía en un único sitio, pero el reloj del backend estaba creado de forma global sin un ciclo de vida definido. La corrección reduce el riesgo de estado duplicado y de llamadas simultáneas durante la navegación.

## Revisión de código por tipo de riesgo

| Tipo de riesgo | Estado |
|---|---|
| Errores JavaScript | sin errores en pruebas de Node |
| Código duplicado | no se detectó un caso crítico que obligara a refactorizar |
| Funciones demasiado grandes | no se requiere cambio de alcance |
| Dependencias circulares | no se detectaron |
| Eventos sin liberar | corregido parcialmente en runtime del juego |
| Recursos Three.js sin liberar | se conserva la lógica de destrucción de `Race`, `GarageView` y `ParallelLab` |
| Problemas de memoria | reducidos con limpieza de temporizadores y carrera activa |
| Estados inconsistentes | corregido al salir de la pantalla de carrera |
| Errores de persistencia | no se detectaron en la lógica validada |
| Botones sin funcionalidad | no se detectaron en navegación principal |
| Problemas de navegación | corregido el caso de carrera activa en segundo plano |

## Pruebas ejecutadas

```bash
cd frontend
npm test
npm run build
```

### Resultado real
- 44 pruebas aprobadas, 0 fallidas.
- Build de producción correcto.
- Existe la advertencia conocida de `chunk > 500 kB`, pero no bloquea la compilación ni afecta a la lógica del juego.

## Conclusión
La fase 7 está en un estado estable y consistente para continuar sin iniciar el Sprint 7.8.2. Los cambios realizados fueron de corrección de estabilidad y limpieza de ciclo de vida, manteniendo intacta la funcionalidad validada previamente.
