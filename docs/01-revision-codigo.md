# 1. Revisión y optimización de código

## 1.1 Backend / API

Código original:

```typescript
app.get('/api/orders', async (req, res) => {
  const userId = req.query.userId;

  const orders = await db.query(
    `SELECT * FROM orders WHERE user_id = ${userId}`
  );

  for (const order of orders.rows) {
    const items = await db.query(
      `SELECT * FROM order_items WHERE order_id = ${order.id}`
    );

    order.items = items.rows;
  }

  res.status(200).json(orders.rows);
});
```

### Problemas encontrados

1. SQL Injection - Seguridad  
   userId se concatena directamente en la consulta SQL
Al venir desde la peticion, un valor manipulado podria modificar la consulta
Se deberian usar consultas parametrizadas

2. Falta de validación de userId - Seguridad / Diseño de API  
   userId se usa directamente desde req.query sin validar si existe o si tiene el formato esperado
La entrada deberia validarse antes de consultar la base de datos

3. N+1 queries - Rendimiento  
   Primero se consulta la lista de ordenes y despues se hace una consulta adicional por cada orden para obtener sus items
Por ejemplo, para 100 ordenes se terminarian ejecutando 101 consultas

4. Consultas secuenciales - Rendimiento  
   El await dentro del for hace que cada consulta espere a que termine la anterior
Esto aumenta el tiempo de respuesta a medida que crece la cantidad de ordenes

5. Uso de SELECT * - Rendimiento / Mantenibilidad  
   Se recuperan todas las columnas de las tablas aunque posiblemente no todas sean necesarias para la respuesta
Es mejor seleccionar de forma explicita los campos que necesita el endpoint

6. Falta de DTO o transformación de respuesta - Mantenibilidad / Diseño de API  
   Se utilizan directamente los objetos obtenidos de la base de datos y ademas se les agrega la propiedad items
Esto hace que la respuesta de la API quede ligada a la estructura de las tablas

7. Falta de paginación - Rendimiento / Diseño de API  
   La consulta devuelve todas las ordenes asociadas al usuario sin establecer un limite
Con una cantidad grande de registros esto puede aumentar el tiempo de consulta y el tamano de la respuesta

8. Mezcla de responsabilidades en el handler - Mantenibilidad  
   El handler concentra validación, acceso a datos y construcción de la respuesta
En una implementación completa estas responsabilidades podrían separarse, aunque en este ejemplo se mantienen juntas para mostrar la solución de forma compacta

### Propuesta de mejora

Para el ejemplo se asume que userId y los identificadores de las ordenes son numericos

```typescript
import { z } from 'zod';

const ordersQuerySchema = z.object({
  userId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

interface OrderItemResponseDto {
  id: number;
  productId: number;
  quantity: number;
  unitPrice: number;
}

interface OrderItemRow {
  id: number;
  order_id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
}

interface OrderResponseDto {
  id: number;
  status: string;
  createdAt: string;
  items: OrderItemResponseDto[];
}

app.get('/api/orders', async (req, res) => {
  const query = ordersQuerySchema.safeParse(req.query);

  if (!query.success) {
    return res.status(400).json({
      error: 'Invalid query parameters',
    });
  }

  const { userId, limit, offset } = query.data;

  const ordersResult = await db.query(
    `
      SELECT id, status, created_at
      FROM orders
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3
    `,
    [userId, limit, offset]
  );

  const orderIds = ordersResult.rows.map((order) => order.id);

  let items: OrderItemRow[] = [];

  if (orderIds.length > 0) {
    const itemsResult = await db.query(
      `
        SELECT id, order_id, product_id, quantity, unit_price
        FROM order_items
        WHERE order_id = ANY($1::int[])
      `,
      [orderIds]
    );

    items = itemsResult.rows;
  }

  const itemsByOrderId = new Map<number, OrderItemResponseDto[]>();

  for (const item of items) {
    const orderItems = itemsByOrderId.get(item.order_id) ?? [];

    orderItems.push({
      id: item.id,
      productId: item.product_id,
      quantity: item.quantity,
      unitPrice: item.unit_price,
    });

    itemsByOrderId.set(item.order_id, orderItems);
  }

  const response: OrderResponseDto[] = ordersResult.rows.map((order) => ({
    id: order.id,
    status: order.status,
    createdAt: order.created_at.toISOString(),
    items: itemsByOrderId.get(order.id) ?? [],
  }));

  return res.status(200).json(response);
});
```

Para mantener el ejemplo simple, la lógica se muestra en un solo bloque
En una implementación completa separaría el acceso a datos y la lógica del endpoint en capas como controller, service y repository

### Índices y ajustes de base de datos

Para la consulta de ordenes consideraria un indice compuesto:

```sql
CREATE INDEX idx_orders_user_id_created_at
ON orders (user_id, created_at DESC, id DESC);
```

La consulta filtra por user_id y ordena por created_at e id, por lo que este índice acompaña ese patrón

Para los items:

```sql
CREATE INDEX idx_order_items_order_id
ON order_items (order_id);
```

Este indice ayuda a recuperar los items relacionados con las ordenes obtenidas

En un escenario real revisaria estos indices con EXPLAIN ANALYZE para confirmar que realmente estan siendo utilizados y que tienen sentido segun el volumen de datos

## 1.2 Frontend / React

Codigo original:

```tsx
function ProductList({ api }) {
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get('/products?search=' + search).then((response) => {
      products.push(...response.data);
      setProducts(products);
    });
  }, [search, products]);

  return (
    <div>
      <input value={search} onChange={(e) => setSearch(e.target.value)} />

      {products.map((p, index) => (
        <Product key={index} data={p} onClick={() => console.log(p)} />
      ))}
    </div>
  );
}
```

### Problemas encontrados

1. Mutacion directa del estado - Mantenibilidad / React

El codigo hace:

```tsx
products.push(...response.data);
```

Esto modifica directamente el arreglo guardado en el estado
En React el estado deberia tratarse como inmutable
La solucion es crear un nuevo arreglo o reemplazar el estado con los nuevos resultados

2. Dependencia incorrecta en useEffect - Rendimiento / React

El efecto depende de:

```tsx
[search, products]
```

Pero dentro del mismo efecto se ejecuta:

```tsx
setProducts(...)
```

Al cambiar products, el efecto puede volver a ejecutarse
Esto puede provocar solicitudes repetidas o ejecuciones innecesarias
La dependencia necesaria para realizar la busqueda es search

3. Se hace una peticion por cada cambio de search - Rendimiento

Cada vez que el usuario escribe una tecla cambia search
Cada cambio vuelve a ejecutar el useEffect
Esto puede generar muchas solicitudes mientras el usuario esta escribiendo
La solucion es usar debounce
En el ejemplo se usan 300 ms, pero no es un valor obligatorio

4. Posibles respuestas fuera de orden - Estado / Rendimiento

Una solicitud anterior puede tardar mas que una solicitud nueva

Ejemplo:

- se busca ca
- despues se busca cam
- la respuesta de cam llega primero
- luego llega la respuesta de ca

La respuesta anterior podria terminar mostrando resultados que ya no corresponden a la busqueda actual
La solucion es cancelar la solicitud anterior o evitar procesar una respuesta que ya quedo obsoleta

5. No hay estado de loading - UX

Mientras se realiza la solicitud no existe informacion que indique que los productos se estan cargando
Se puede agregar un estado loading
Ese estado permite mostrar un mensaje o indicador mientras se espera la respuesta

6. No hay manejo de errores - UX / Mantenibilidad

La llamada:

```tsx
api.get(...)
```

solo maneja el caso exitoso
Si la solicitud falla no existe un estado para guardar o mostrar el error
Se puede agregar un estado error
La interfaz puede informar que la carga fallo

7. No hay cancelacion de solicitudes - Rendimiento / Mantenibilidad

Si search cambia mientras existe una solicitud activa, la solicitud anterior puede seguir ejecutandose
La solucion es cancelar la solicitud anterior cuando el efecto se limpie
Una forma simple es usar AbortController
Esto tambien ayuda con el problema de respuestas fuera de orden

Nota sobre key={index}

Si los productos tienen un identificador estable, es preferible usar key={product.id}
El indice puede cambiar cuando cambia el orden de la lista
Esto supone que el producto tiene un id

### Solicitudes mientras el usuario escribe

El debounce espera un pequeno tiempo despues del ultimo cambio antes de hacer la solicitud
Si el usuario vuelve a escribir antes de que termine ese tiempo, se reinicia la espera
Asi se evita hacer una peticion por cada tecla

### Manejo de estado y solicitudes

loading se activa antes de iniciar la solicitud
error se limpia antes de una nueva solicitud
si la solicitud falla se guarda un mensaje de error
AbortController permite cancelar una solicitud anterior
el cleanup de useEffect cancela la solicitud pendiente
una solicitud cancelada no deberia mostrarse como un error normal

### Propuesta de mejora

```tsx
import { useEffect, useState } from 'react';

interface ProductData {
  id: string;
  name: string;
}

export function ProductList() {
  const [products, setProducts] = useState<ProductData[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const timeoutId = window.setTimeout(async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `/products?search=${encodeURIComponent(search)}`,
          {
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error('Request failed');
        }

        const data: ProductData[] = await response.json();

        setProducts(data);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        setError('Could not load products');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [search]);

  return (
    <div>
      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {loading && <p>Loading...</p>}

      {error && <p>{error}</p>}

      {products.map((product) => (
        <Product
          key={product.id}
          data={product}
          onClick={() => console.log(product)}
        />
      ))}
    </div>
  );
}
```

El debounce evita hacer una solicitud por cada tecla
AbortController cancela la solicitud anterior cuando cambia la busqueda
Los estados loading y error permiten mostrar lo que esta pasando en la interfaz

## 1.3 SQL / datos

Codigo original:

```sql
SELECT c.name,
       COUNT(o.id) AS orders,
       SUM(oi.quantity * oi.unit_price) AS revenue
FROM customers c
JOIN orders o ON o.customer_id = c.id
JOIN order_items oi ON oi.order_id = o.id
WHERE DATE(o.created_at) = '2026-10-01'
GROUP BY c.name
ORDER BY revenue DESC;
```

### Problemas encontrados

1. Uso de DATE() sobre created_at - Rendimiento

Actualmente se usa:

```sql
WHERE DATE(o.created_at) = '2026-10-01'
```

Se esta aplicando una funcion directamente sobre la columna
Esto puede dificultar que la base de datos aproveche correctamente un indice sobre created_at
La mejora es trabajar con un rango de fechas

```sql
WHERE o.created_at >= '2026-10-01 00:00:00'
  AND o.created_at < '2026-10-02 00:00:00'
```

Se toma el inicio del dia y el inicio del dia siguiente

2. COUNT(o.id) puede contar una orden varias veces - Exactitud

La consulta hace un JOIN con order_items
Una orden puede tener varios items
Eso hace que una misma orden aparezca en varias filas del resultado intermedio

Por esta razon:

```sql
COUNT(o.id)
```

puede contar varias veces la misma orden
La correccion es usar:

```sql
COUNT(DISTINCT o.id)
```

3. Agrupar solamente por c.name - Exactitud

Actualmente se usa:

```sql
GROUP BY c.name
```

Dos clientes diferentes pueden tener el mismo nombre
Si eso ocurre, sus datos podrian terminar agrupados como si fueran el mismo cliente
La mejora es incluir tambien el identificador

```sql
GROUP BY c.id, c.name
```

4. Zona horaria del filtro por fecha - Exactitud

El significado de un dia depende de la zona horaria usada por la aplicacion y la base de datos
El rango para filtrar el dia debe construirse con la zona horaria definida por el sistema

### Consulta mejorada

```sql
SELECT
    c.id,
    c.name,
    COUNT(DISTINCT o.id) AS orders,
    SUM(oi.quantity * oi.unit_price) AS revenue
FROM customers c
JOIN orders o ON o.customer_id = c.id
JOIN order_items oi ON oi.order_id = o.id
WHERE o.created_at >= '2026-10-01 00:00:00'
  AND o.created_at < '2026-10-02 00:00:00'
GROUP BY c.id, c.name
ORDER BY revenue DESC;
```

El filtro usa un rango desde el inicio del dia hasta el inicio del siguiente
De esta forma no se aplica una funcion sobre created_at
COUNT(DISTINCT o.id) evita contar varias veces una orden que tenga varios items
Agrupar por id y nombre evita mezclar clientes que tengan el mismo nombre

### Indices

Para la consulta de ordenes consideraria este indice:

```sql
CREATE INDEX idx_orders_created_at_customer_id
ON orders (created_at, customer_id);
```

Puede ayudar a localizar las ordenes dentro del rango de fechas
customer_id tambien participa en el join con customers
El orden de un indice compuesto depende del patron real de consultas

Para los items consideraria:

```sql
CREATE INDEX idx_order_items_order_id
ON order_items (order_id);
```

Este indice ayuda con el join por order_items.order_id

Normalmente customers.id seria una primary key y ya tendria un indice asociado

En un sistema real revisaria los indices con:

```sql
EXPLAIN ANALYZE
```

### Si `orders` tiene cientos de millones de registros

Con cientos de millones de registros revisaria primero el plan de ejecucion con EXPLAIN ANALYZE
Tambien revisaria el volumen real que procesa la consulta
Despues validaria que los indices usados por las consultas principales sean adecuados
Si las consultas trabajan principalmente por fecha consideraria particionar orders por rangos de tiempo
No lo tomaria como una regla automatica solo por el tamano de la tabla
Para reportes ejecutados constantemente evaluaria preagregaciones o vistas materializadas
Los datos historicos tambien podrian archivarse si el negocio no necesita consultarlos constantemente
