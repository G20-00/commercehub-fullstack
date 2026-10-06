# 4. Frontend y experiencia de usuario

## 4.1 Estados del checkout

Usaria estados explicitos para que el checkout no dependa solo de un booleano como isLoading

```text
idle
validating
submitting
confirmed
recoverable_error
final_error
unknown_result
```

idle:
estado inicial
el usuario revisa direccion, productos, cantidades y total
el boton Pagar esta disponible si el checkout es valido

validating:
se validan datos locales antes de enviar
por ejemplo direccion requerida, carrito no vacio y metodo de pago si aplica
el backend sigue siendo la fuente final para precios, stock y validez de la orden

submitting:
la orden ya fue enviada
se muestra un mensaje como Procesando pago...
el boton Pagar queda deshabilitado temporalmente
no se permite otro submit mientras la misma solicitud esta activa
el total y el resumen de compra siguen visibles

confirmed:
la operacion termino correctamente
se muestra el identificador de la orden y el estado final recibido del backend
el usuario no deberia poder ejecutar el mismo checkout otra vez por accidente

recoverable_error:
se usa cuando tiene sentido intentar otra vez
por ejemplo red inestable, timeout o servidor temporalmente no disponible
el reintento debe reutilizar la misma Idempotency-Key si es la misma operacion

final_error:
se usa cuando repetir igual no resolveria el problema
por ejemplo stock insuficiente, producto no disponible o datos invalidos
el usuario debe corregir algo antes de intentar de nuevo

unknown_result:
el POST fue enviado pero la conexion se perdio antes de recibir respuesta
el frontend no sabe si la orden no llego o si fue creada y solo se perdio la respuesta
no debe mostrar automaticamente El pago fallo
no debe enviar una nueva orden con otra Idempotency-Key

Flujo resumido:

normalmente empieza en idle
luego pasa por validating y submitting

desde submitting puede terminar en confirmed
o puede caer en recoverable_error, final_error o unknown_result

si queda en unknown_result, el siguiente intento usa la misma Idempotency-Key

## 4.2 Doble clic y doble envio

Hay dos niveles de proteccion

Frontend:
cuando empieza el submit se bloquea el envio actual

```tsx
<button
  type="submit"
  disabled={checkoutState === 'submitting'}
>
  {checkoutState === 'submitting' ? 'Procesando...' : 'Pagar'}
</button>
```

Esto mejora la UX
pero no es garantia suficiente

Pueden existir reintentos del navegador, perdida de red, dos tabs o dos dispositivos

Backend:
la garantia real es Idempotency-Key
el frontend genera una clave para el intento de checkout
la misma operacion reutiliza la misma clave

Si hubo timeout o perdida de conexion, no se genera una key nueva para el mismo intento
el backend del punto 3 responde con la operacion existente si recibe la misma key y el mismo payload

Si el usuario modifica el carrito o inicia una compra diferente, se genera una nueva Idempotency-Key

El boton no debe quedar deshabilitado para siempre

Si submitting termina en recoverable_error, el usuario puede reintentar

Si submitting termina en unknown_result, primero se intenta recuperar el resultado o reintentar con la misma referencia
no se deja un loading infinito

## 4.3 Perdida de conexion despues del POST

El caso delicado es cuando el usuario presiona Pagar y el POST si alcanza a llegar al backend
El backend puede crear la orden
pero la conexion se corta antes de que el frontend reciba la respuesta

Desde el punto de vista del usuario parece que algo fallo
pero para el sistema la orden pudo haber quedado creada

Por eso el frontend puede no recibir respuesta aunque el backend haya creado la orden
por eso no debe asumir que la orden fallo

Flujo esperado:

antes de enviar se genera una Idempotency-Key
el POST usa esa key

si la conexion se pierde, el frontend conserva esa misma key
la pantalla puede pasar a unknown_result o recoverable_error

si el usuario reintenta, no se crea una nueva operacion
se reutiliza la misma Idempotency-Key

si la orden ya habia sido creada, el backend devuelve esa operacion existente

Si existiera un endpoint de consulta tambien podria usarse
por ejemplo GET /api/v1/orders/{orderId}
o una consulta asociada a la operacion idempotente

No lo haria obligatorio para esta respuesta
la solucion principal es reutilizar Idempotency-Key

La key no deberia vivir solo en una variable fragil
debe mantenerse durante el intento de checkout
puede estar en el estado del flujo

Si se quiere recuperar el intento despues de recargar la pagina, podria guardarse en sessionStorage
no lo agregaria por defecto si no hace falta

## 4.4 Accesibilidad

Formularios:
cada input debe tener label asociado
placeholder no reemplaza al label

```tsx
<label htmlFor="address">Direccion</label>
<input
  id="address"
  name="address"
  aria-describedby={addressError ? 'address-error' : undefined}
/>
```

Errores:
el error debe asociarse al campo correspondiente

```tsx
<p id="address-error" role="alert">
  Ingresa una direccion valida
</p>
```

Si falla la validacion, se puede mover el foco al primer campo invalido
el mensaje debe explicar que paso y que puede hacer el usuario
no basta con mostrar Error 422

Estado del pago:
los cambios asincronos importantes deben anunciarse sin ser invasivos

```html
<p aria-live="polite">Procesando pago...</p>
```

Se puede usar para mensajes como:

- Procesando pago
- Orden confirmada
- No pudimos confirmar el resultado

Boton Pagar:
debe tener texto claro
debe ser operable con teclado
debe mostrar visualmente cuando esta deshabilitado
debe conservar contraste suficiente
no debe depender solo del color para comunicar estado

## 4.5 Estado local, global y server state

Estado local:
pertenece a la pantalla o interaccion actual

```text
checkoutState
errores de formulario
campos aun no persistidos
isSubmitting
mensaje temporal de error
Idempotency-Key del intento actual
```

Si la direccion existe en backend, el dato persistido es server state
la edicion temporal puede ser local

Estado global:
solo datos usados por varias partes de la aplicacion

```text
sesion del usuario
identidad/autenticacion
cartId si varias pantallas lo necesitan
tienda o moneda si aplica
```

No pondria todo el checkout en estado global
no agregaria una libreria de estado solo para este flujo

Server state:
la fuente de verdad esta en el servidor

```text
carrito persistido
productos
precios
stock
orden
estado del pago
direcciones guardadas
```

Estos datos pueden quedar obsoletos
el frontend no debe asumir que precio o stock siguen siendo validos al presionar Pagar
el backend vuelve a validar todo en POST /api/v1/orders

Relacion con el punto 3:

```text
POST /api/v1/orders
Idempotency-Key
PENDING_PAYMENT
201 Created
200 OK en replay idempotente
409 para conflicto de idempotencia
422 para errores de negocio
```
