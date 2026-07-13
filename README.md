# Nanopaquete

App experimental para comprar y vender XNO con custodia manual.

## Flujo MVP

1. El vendedor transfiere la cantidad de XNO en venta a la wallet de custodia.
2. Registra la transferencia en Nanopaquete y recibe el contacto privado del custodio.
3. Publica una oferta con divisa, precio y contacto privado.
4. La oferta aparece publica sin mostrar el contacto del vendedor.
5. Un comprador toma la oferta, registra su wallet Nano receptora y recibe el contacto del vendedor.
6. La oferta pasa a negociacion y deja de estar visible como oferta publica.
7. Los fondos solo deben liberarse a la wallet registrada por el comprador.
8. Para liberar, el vendedor paga la comision de custodia de 0.1 XNO y coordina con el custodio.
9. Si hay disputa, el custodio revisa el caso y decide mantener bloqueado, cancelar o liberar.

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
- `NANOPAQUETE_ESCROW_WALLET`: wallet Nano de custodia.
- `NANOPAQUETE_CUSTODIAN_CONTACT`: contacto privado del custodio.
- `NANOPAQUETE_ADMIN_USER`: usuario admin, por defecto `admin`.
- `NANOPAQUETE_ADMIN_PASSWORD`: clave admin, por defecto `nanopaquete`.

## Admin

`/admin/offers` permite revisar ofertas, negociaciones y cambiar estados manualmente.
