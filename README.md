# Nanopaquete

App experimental para comprar y vender XNO con custodia manual.

## Flujo MVP

1. El vendedor inicia un deposito y Nanopaquete muestra boton movil y QR para pagar a la wallet de custodia.
2. La cantidad de XNO en venta queda definida por la transferencia confirmada en la red Nano.
3. Al verificar el deposito, se habilita el formulario de divisa, precio y contacto privado.
4. Publica una oferta con la cantidad detectada, divisa, precio y contacto privado.
5. La oferta aparece publica sin mostrar el contacto del vendedor.
6. Un comprador toma la oferta, registra su wallet Nano receptora y recibe el contacto del vendedor.
7. La oferta pasa a negociacion y deja de estar visible como oferta publica.
8. Los fondos solo deben liberarse a la wallet registrada por el comprador.
9. Para liberar, el vendedor paga la comision de custodia de 0.1 XNO y coordina con el custodio.
10. Si hay disputa, el custodio revisa el caso y decide mantener bloqueado, cancelar o liberar.

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
- `NANOPAQUETE_CUSTODIAN_CONTACT`: contacto privado del custodio.
- `NANOPAQUETE_ADMIN_USER`: usuario admin, por defecto `admin`.
- `NANOPAQUETE_ADMIN_PASSWORD`: clave admin, por defecto `nanopaquete`.
- `NANO_RPC_URL`: nodo Nano RPC, por defecto `http://127.0.0.1:7076`.
- `NANO_RPC_FALLBACK_URLS`: nodos RPC alternos separados por coma.

## Admin

`/admin/offers` permite revisar ofertas, negociaciones y cambiar estados manualmente.
