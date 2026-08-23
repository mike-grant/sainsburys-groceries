/**
 * Adding items when a slot is booked amends the upcoming order (that is how
 * Sainsbury's models amendments pre-checkout). Without a booked slot, items
 * land in the normal basket.
 */
export async function smartAdd(client, queryOrSku, quantity = 1) {
    const product = await client.resolveProduct(queryOrSku);
    let reservation = null;
    try {
        reservation = await client.getReservation();
    }
    catch {
        // not logged in or no postcode set yet; treat as plain basket
    }
    const hasBookedSlot = !!reservation?.slot || /booked/i.test(String(reservation?.reservation_type ?? ""));
    const basket = await client.addToBasket(String(product.product_uid), quantity, product.uom ?? "ea", hasBookedSlot);
    return {
        productUid: String(product.product_uid),
        name: String(product.name ?? product.product_uid),
        quantity,
        target: hasBookedSlot ? "next-delivery" : "basket",
        basket,
    };
}
