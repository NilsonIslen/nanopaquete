# Nanopaquete

App experimental para comprar y vender XNO con custodia automatica.

## Flujo actual

Nanopaquete publica ofertas de compra y venta de XNO en una misma pagina. Las ofertas de compra se diferencian visualmente de las ofertas de venta para que cada usuario pueda revisar el mercado disponible antes de publicar una oferta propia.

La plataforma no persigue el precio del mercado. Cada usuario define cuanta cantidad del activo acepta entregar o recibir por sus XNO. Esa libertad crea un mercado interno donde la competencia entre ofertas regula la inflacion o depreciacion dentro de la plataforma.

### Publicar venta de Nano

1. El vendedor crea una oferta de venta con la cantidad de XNO, el activo que recibe a cambio, la cantidad de ese activo y su numero de contacto.
2. La oferta queda publicada y vinculada al equipo desde el que fue creada.
3. Mientras nadie tome la oferta, el vendedor puede eliminarla. Las ofertas disponibles vencen automaticamente a las 24 horas.
4. El comprador toma la oferta e ingresa su numero de contacto y la cuenta Nano donde espera recibir los fondos.
5. Nanopaquete crea una cuenta Nano temporal para la custodia de esa negociacion, la guarda de forma segura en el servidor y no la muestra a los usuarios.
6. El comprador ve que el vendedor esta siendo notificado para depositar los XNO.
7. El vendedor recibe la notificacion, ve el boton y el QR de deposito, y deposita la cantidad publicada mas el 0,2% de comision de plataforma.
8. Cuando el deposito queda confirmado, el vendedor ve el contacto del comprador y se le habilita el boton para confirmar el pago recibido.
9. El comprador ve el contacto del vendedor y el mensaje de que los XNO estan en custodia para que pueda comunicarse y acordar el pago.
10. Cuando el vendedor confirma que recibio el pago, Nanopaquete transfiere los XNO a la cuenta Nano registrada por el comprador y cierra la negociacion.

### Publicar compra de Nano

1. El comprador crea una oferta de compra con la cantidad de XNO que quiere comprar, el activo que entrega a cambio, la cantidad de ese activo, su cuenta Nano receptora y su numero de contacto.
2. La oferta queda publicada junto a las ofertas de venta, diferenciada visualmente por tipo.
3. Cuando un vendedor toma la oferta, ingresa su numero de contacto.
4. Nanopaquete crea una cuenta Nano temporal para la custodia de esa negociacion, la guarda de forma segura en el servidor y habilita al vendedor el boton y el QR para depositar.
5. El vendedor deposita la cantidad de XNO de la oferta mas el 0,2% de comision de plataforma.
6. Cuando el deposito queda confirmado, Nanopaquete notifica al comprador y muestra los numeros de contacto para que ambas partes acuerden el pago.
7. Cuando el comprador paga, el vendedor confirma la recepcion del pago y Nanopaquete libera los XNO a la cuenta Nano registrada por el comprador.

## Disputas

Si aparece una disputa durante una negociacion, las partes deben conservar comprobantes y contactar al administrador de Nanopaquete al 3008188284.

## Comandos

```bash
npm install
npm run dev
npm run dev:api
npm run build
npm run lint
```

## Configuracion

- `VITE_NANOPAQUETE_API_URL`: URL del backend. En local usa `http://localhost:8789/api`.
- `NANOPAQUETE_API_PORT`: puerto API, por defecto `8789`.
- `NANOPAQUETE_ESCROW_WALLET`: wallet Nano de custodia. Por defecto usa `nano_1j7csyciamkzktswyxey5yt6f1rg1zbw3rtioe7xdze4fekkbo7zxri3ijxd`.
- `NANOPAQUETE_CUSTODIAN_CONTACT`: contacto privado para administracion de custodia. Por defecto usa `+573008188284`.
- `NANOPAQUETE_ACCOUNT_SECRET`: secreto usado para cifrar las claves privadas de las cuentas Nano generadas por el backend. En produccion debe ser una cadena larga y privada.
- `NANOPAQUETE_ADMIN_PASSWORD`: clave usada solo como respaldo para derivar el cifrado si no se configura `NANOPAQUETE_ACCOUNT_SECRET`.
- `NANO_RPC_URL`: nodo Nano RPC, por defecto `http://127.0.0.1:7076`.
- `NANO_RPC_FALLBACK_URLS`: nodos RPC alternos separados por coma.
- `NANO_WALLET_ID`: wallet local del nodo Nano usada para importar temporalmente las claves cifradas y retirar fondos desde las cuentas generadas. El nodo debe permitir comandos de control.

## Pagina privada

`/?admin=1` abre el acceso privado. Para entrar se debe autenticar una cuenta Nano autorizada como custodio.

`/admin/offers` permite revisar ofertas, negociaciones, contactos de las partes y estados operativos.

`/admin/nano-accounts` permite generar cuentas Nano reales desde el nodo RPC, guardar la clave privada cifrada, administrar estado/uso/notas y retirar la comision disponible hacia la wallet de custodia predeterminada.
