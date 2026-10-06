# 5. Testing, seguridad y diagnostico

## 5.1 Pruebas prioritarias

1. Request valido - Integracion
Crea una orden, items, reserva y pago pendiente
Descuenta stock y responde 201 Created

2. Stock insuficiente - Integracion
Prepara inventario menor a la cantidad solicitada
Debe responder 422, hacer rollback y no dejar stock negativo

3. Dos compras concurrentes por la ultima unidad - Integracion
Dos requests compiten por una sola unidad disponible
Solo uno reserva stock y el otro falla sin dejar inventario negativo

4. Misma Idempotency-Key y mismo payload - Integracion
Enviar dos veces la misma operacion devuelve la orden existente
No crea otra orden, no descuenta stock dos veces y no crea otro pago

5. Misma Idempotency-Key con payload diferente - Integracion
Enviar la misma key con otro body devuelve conflicto
No crea una nueva orden y responde 409 Conflict

6. Error durante la transaccion - Integracion
Simula un error despues de reservar stock y antes del COMMIT
Debe ejecutar rollback y no dejar orden, items ni reservas parciales

7. Timeout del proveedor de pagos - Integracion
La orden queda creada y la transaccion ya termino
Si el proveedor no responde, la orden sigue PENDING_PAYMENT y no se marca como fallida automaticamente

8. Flujo principal de checkout - E2E
El usuario revisa checkout, presiona Pagar, ve procesamiento y luego confirmacion
El boton no debe permitir doble envio mientras la solicitud esta activa

## 5.2 Seguridad

- Broken Access Control: validar autenticacion, roles y ownership de la orden en backend
- Injection: usar SQL parametrizado y validar input
- Authentication Failures: proteger sesiones/tokens y controlar expiracion
- Sensitive Data: usar HTTPS, secretos fuera del codigo y no guardar datos completos de tarjeta
- Security Misconfiguration: usar permisos minimos y errores sin informacion interna
- Logging/Monitoring: usar logs estructurados, correlation id y alertas sin registrar datos sensibles

Los webhooks deben validar firma o autenticidad
El event id debe ser UNIQUE para evitar procesarlo dos veces

## 5.3 Diagnostico de ordenes duplicadas

1. Revisar el patron

Comparar los duplicados con:

- latencia del proveedor
- timeouts
- retry del frontend
- misma o diferente Idempotency-Key

2. Correlacionar logs

Buscar:

```text
request_id
idempotency_key
order_id
provider_payment_id
timestamps
```

Reconstruir si paso algo como:

```text
orden creada
proveedor tarda
cliente reintenta
segunda orden
```

3. Revisar implementacion

Comprobar:

- misma Idempotency-Key en retry
- UNIQUE en PostgreSQL
- llamada al proveedor despues del COMMIT
- no crear otra orden por timeout

Tambien revisaria retries de cliente, proxy o gateway si existen en la infraestructura

4. Corregir con evidencia

No asumiria la causa antes de revisar logs y base de datos
Corregiria el punto que realmente este fallando

Ejemplos:

- reutilizar Idempotency-Key
- corregir UNIQUE
- mover llamada externa fuera de transaccion
- no crear otra orden ante un timeout ambiguo

## 5.4 Migracion sin interrupcion

1. Agregar new_column sin eliminar old_column

```sql
ALTER TABLE example
ADD COLUMN new_column TEXT;
```

2. Desplegar backend compatible

Temporalmente puede leer new_column con fallback a old_column
Tambien puede escribir ambas columnas mientras dura la transicion

3. Hacer backfill

```sql
UPDATE example
SET new_column = old_column
WHERE new_column IS NULL;
```

Si la tabla es grande, hacerlo por lotes

4. Eliminar old_column despues

Cuando ninguna version activa use old_column:

```sql
ALTER TABLE example
DROP COLUMN old_column;
```

Ese paso debe ir en un despliegue posterior
Mientras old_column siga existiendo es mas facil volver temporalmente a la version anterior del backend
