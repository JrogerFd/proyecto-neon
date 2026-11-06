# NEON CUP

## Circuitos y puntuación

La copa reúne una carrera real por cada pista:

1. NEON CITY (`neon_city`)
2. CYBER DESERT (`cyber_desert`)
3. PLASMA CIRCUIT (`plasma_circuit`)

Puntuación por posición: 1.º 15, 2.º 12, 3.º 10, 4.º 8; puestos posteriores y
abandonos obtienen 0. La clasificación solo incorpora participantes que aparecen
en los resultados reales de la carrera. Un empate en puntos declara `EMPATE` y
no crea un campeón artificial ni un premio de campeón.

Se conserva el primer resultado de cada pista en el ciclo persistido. Al
registrarse las tres pistas, el líder real gana 1000 NC y 300 XP. El resultado
por carrera y el premio de copa tienen IDs de transacción distintos.

## Flujo y límites

El estado del ciclo contiene participantes, puntos de cada pista, clasificación,
estado y campeón; está en el mismo perfil versionado. Los circuitos se pueden
seleccionar en cualquier orden desde el mapa y la interfaz actual no impide
repetir una pista; la repetición no reemplaza la ronda ya registrada. No hay
ranking online ni autenticación de resultados.
