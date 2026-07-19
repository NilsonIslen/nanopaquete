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

Si aparece una disputa durante una negociacion, las partes deben conservar comprobantes y contactar a un conciliador de Nanopaquete. Los conciliadores son personas de confianza de la plataforma que autorizan mostrar sus datos para ayudar a resolver disputas.

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
- `NANOPAQUETE_CUSTODIAN_CONTACT`: contacto publico del conciliador base para disputas.
- `NANOPAQUETE_ACCOUNT_SECRET`: secreto usado para cifrar las claves privadas de las cuentas Nano generadas por el backend. En produccion debe ser una cadena larga y privada.
- `NANOPAQUETE_ADMIN_PASSWORD`: clave usada solo como respaldo para derivar el cifrado si no se configura `NANOPAQUETE_ACCOUNT_SECRET`.
- `NANOPAQUETE_VAPID_PUBLIC_KEY`: clave publica VAPID para notificaciones push.
- `NANOPAQUETE_VAPID_PRIVATE_KEY`: clave privada VAPID para notificaciones push.
- `NANOPAQUETE_VAPID_SUBJECT`: contacto VAPID, por ejemplo `mailto:admin@nanopaquete.com`.
- `NANO_RPC_URL`: nodo Nano RPC, por defecto `http://127.0.0.1:7076`.
- `NANO_RPC_FALLBACK_URLS`: nodos RPC alternos separados por coma.
- `NANO_WALLET_ID`: wallet local del nodo Nano usada para importar temporalmente las claves cifradas y retirar fondos desde las cuentas generadas. El nodo debe permitir comandos de control.

Para generar las claves VAPID:

```bash
npx web-push generate-vapid-keys
```

## Pagina privada

`/?admin=1` abre el acceso privado. Para entrar se debe autenticar una cuenta Nano autorizada como conciliador.

`/admin/offers` permite revisar ofertas, negociaciones, chats y estados operativos. Los conciliadores pueden escribir en el chat de una oferta cuando ya existe deposito Nano confirmado.

`/admin/nano-accounts` permite generar cuentas Nano reales desde el nodo RPC, guardar la clave privada cifrada, administrar estado/uso/notas y retirar la comision disponible hacia la wallet de custodia predeterminada.

Las direcciones autorizadas pueden tener perfil de conciliador o administrador. Los conciliadores solo entran a ofertas; los administradores entran a ofertas y cuentas Nano, y pueden autorizar nuevas direcciones.
