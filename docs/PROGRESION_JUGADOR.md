# Perfil y progresión

El perfil local contiene alias, fecha de creación, nivel, experiencia acumulada,
saldo NC, vehículo/piloto seleccionado, estadísticas, récords, misiones y NEON
CUP. `Profile.load` migra campos conocidos y limpia valores corruptos; `save`
escribe atómicamente el documento completo.

La experiencia por nivel crece: nivel 1→2 requiere 100 XP, 2→3 150 XP, y cada
nivel posterior añade 50 XP al requisito anterior. Una carrera completada da
100 XP, ganar añade 50; cada misión completada da 40 XP; ganar la copa da 300.

Se guardan carreras, finalizaciones, victorias, podios, derrotas, abandonos,
vueltas válidas, distancia recorrida, tiempo, colisiones, misiones y
campeonatos. Los campos históricos de saltos pueden seguir existiendo en
perfiles anteriores, pero la física plana ya no genera saltos. Los récords no
empeoran; se indexan por circuito e
incluyen `geometry_version`, fecha, vehículo y modo.

No hay pantalla dedicada de perfil ni todos los contadores solicitados
(adelantamientos, nitro, favorito). El progreso solo se conserva en este
navegador/equipo y no se sincroniza entre dispositivos.
