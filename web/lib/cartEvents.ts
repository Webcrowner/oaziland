export const CART_CHANGED_EVENT = "oaziland:cart-changed";

export function notifyCartChanged(): void {
  window.dispatchEvent(new Event(CART_CHANGED_EVENT));
}
