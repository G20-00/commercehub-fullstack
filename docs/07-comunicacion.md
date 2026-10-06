# 7. Comunicacion tecnica

La decision que considero mas riesgosa es empezar con un monolito modular

Me parece una buena decision para el inicio porque reduce complejidad operativa, mantiene las transacciones mas simples y permite avanzar mas rapido
El riesgo es que algunos modulos terminen necesitando escalar o desplegarse de forma independiente
Por ejemplo payments puede requerir mas aislamiento por integraciones externas
Notifications puede crecer mucho si aumenta el volumen de eventos asincronos

La alternativa que evaluaria seria separar servicios puntuales como payments o notifications
Pero no empezaria con microservicios solo por anticipar problemas
Primero mantendria limites claros dentro del monolito y mediria el comportamiento real

Para confirmar la decision necesitaria informacion de produccion o pruebas de carga
Revisaria crecimiento real del trafico, volumen de pagos, tiempos de respuesta y frecuencia de despliegues
Tambien miraria fallos por modulo, necesidad de escalar componentes por separado y requerimientos de aislamiento o seguridad

Si los datos muestran que un modulo limita al resto del sistema, entonces tendria sentido separarlo
Hasta ese momento, dividir antes de medir agregaria mas complejidad que valor
