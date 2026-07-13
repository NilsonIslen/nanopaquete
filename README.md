# Nanopaquete

App experimental para comprar y vender XNO con custodia manual.

## Flujo MVP

1. El vendedor completa la cantidad de XNO, activo a recibir, precio total del paquete y contacto privado.
2. Nanopaquete genera un deposito por la cantidad exacta hacia la wallet de custodia.
3. Al verificar el deposito, la oferta se publica automaticamente con los datos del formulario.
4. La cantidad de XNO en venta queda definida por el monto exacto solicitado en el deposito.
5. La oferta aparece publica sin mostrar el contacto del vendedor.
6. Un comprador toma la oferta, registra su wallet Nano receptora y recibe el contacto del vendedor.
7. La oferta pasa a negociacion y sigue visible con su estado.
8. Los fondos solo deben liberarse a la wallet registrada por el comprador.
9. Para confirmar que recibio el pago, el vendedor usa el boton Liberar fondos y paga la comision de custodia de 0.1 XNO desde la wallet que publico la oferta.
10. Cuando Nanopaquete detecta esa comision, la oferta pasa a estado liberando.
11. El custodio solo debe liberar fondos hacia la wallet del comprador cuando la oferta esta en estado liberando.
12. Si hay disputa, el custodio revisa el caso y decide mantener bloqueado, cancelar o liberar segun corresponda.

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
- Custodio por defecto: `Nilson Islen Castrillon`.
- `NANOPAQUETE_ESCROW_WALLET`: wallet Nano del primer custodio. Por defecto usa `nano_1j7csyciamkzktswyxey5yt6f1rg1zbw3rtioe7xdze4fekkbo7zxri3ijxd`.
- `NANOPAQUETE_CUSTODIAN_CONTACT`: contacto privado del primer custodio. Por defecto usa `+573008188284`.
- `NANOPAQUETE_CUSTODIANS_JSON`: lista JSON opcional para multiples custodios, con campos `id`, `name`, `wallet` y `contact`. Por ahora Nanopaquete usa el primer custodio valido de la lista.
- `NANOPAQUETE_ADMIN_USER`: usuario admin, por defecto `admin`.
- `NANOPAQUETE_ADMIN_PASSWORD`: clave admin, por defecto `nanopaquete`.
- `NANO_RPC_URL`: nodo Nano RPC, por defecto `http://127.0.0.1:7076`.
- `NANO_RPC_FALLBACK_URLS`: nodos RPC alternos separados por coma.

## Admin

`/admin/offers` permite revisar ofertas, negociaciones y cambiar estados manualmente.
